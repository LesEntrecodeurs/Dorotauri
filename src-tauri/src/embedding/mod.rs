//! Embedding engine using MiniLM (ONNX Runtime) for 384-dimensional vector embeddings.
//!
//! Downloads the `sentence-transformers/all-MiniLM-L6-v2` model from HuggingFace on first use,
//! then runs inference locally via ONNX Runtime + the `tokenizers` crate.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ndarray::Array2;
use ort::session::Session;
use ort::value::TensorRef;
use tokenizers::Tokenizer;

/// HuggingFace URLs for the MiniLM model files.
const MODEL_URL: &str =
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx";
const TOKENIZER_URL: &str =
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json";

/// Output embedding dimensions for all-MiniLM-L6-v2.
const DIMS: usize = 384;

/// Generates 384-dimensional vector embeddings from text using MiniLM (ONNX Runtime).
///
/// # Usage
/// ```ignore
/// let mut engine = EmbeddingEngine::new(&data_dir);
/// engine.init().await?;
/// if engine.is_ready() {
///     let embedding = engine.embed("hello world");
/// }
/// ```
pub struct EmbeddingEngine {
    models_dir: PathBuf,
    inner: Option<Mutex<EngineInner>>,
}

/// Holds the loaded ONNX session and tokenizer.
struct EngineInner {
    session: Session,
    tokenizer: Tokenizer,
}

impl EmbeddingEngine {
    /// Create a new engine. `data_dir` is typically `~/.dorotoring/`.
    /// The model files will be stored under `data_dir/models/`.
    pub fn new(data_dir: &Path) -> Self {
        Self {
            models_dir: data_dir.join("models"),
            inner: None,
        }
    }

    /// Download model files if missing, then load the ONNX session and tokenizer.
    ///
    /// If this fails (e.g. no internet and files not cached), the engine stays
    /// inactive and `is_ready()` returns false.
    pub async fn init(&mut self) -> Result<(), String> {
        std::fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("Failed to create models dir: {e}"))?;

        let model_path = self.models_dir.join("all-MiniLM-L6-v2.onnx");
        let tokenizer_path = self.models_dir.join("all-MiniLM-L6-v2-tokenizer.json");

        // Download files if they don't exist yet.
        if !model_path.exists() {
            download_file(MODEL_URL, &model_path).await?;
        }
        if !tokenizer_path.exists() {
            download_file(TOKENIZER_URL, &tokenizer_path).await?;
        }

        // Load tokenizer.
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {e}"))?;

        // Load ONNX session.
        let session = Session::builder()
            .map_err(|e| format!("Failed to create session builder: {e}"))?
            .with_intra_threads(1)
            .unwrap_or_else(|e| e.recover())
            .commit_from_file(&model_path)
            .map_err(|e| format!("Failed to load ONNX model: {e}"))?;

        self.inner = Some(Mutex::new(EngineInner {
            session,
            tokenizer,
        }));

        Ok(())
    }

    /// Returns `true` if the engine loaded successfully and can produce embeddings.
    pub fn is_ready(&self) -> bool {
        self.inner.is_some()
    }

    /// Returns the output embedding dimensions (384).
    pub fn dims(&self) -> usize {
        DIMS
    }

    /// Generate a 384-dimensional embedding for the given text.
    ///
    /// Returns `None` if the engine is not ready or inference fails.
    /// This is synchronous -- ONNX inference is CPU-bound and fast (~15ms).
    pub fn embed(&self, text: &str) -> Option<Vec<f32>> {
        let inner = self.inner.as_ref()?;
        let mut guard = inner.lock().ok()?;
        embed_inner(&mut guard, text)
    }
}

/// Run tokenization + ONNX inference + mean pooling + L2 normalization.
fn embed_inner(inner: &mut EngineInner, text: &str) -> Option<Vec<f32>> {
    // 1. Tokenize
    let encoding = inner.tokenizer.encode(text, true).ok()?;
    let ids = encoding.get_ids();
    let attention_mask = encoding.get_attention_mask();
    let type_ids = encoding.get_type_ids();

    let seq_len = ids.len();
    if seq_len == 0 {
        return None;
    }

    // 2. Convert to i64 arrays (ONNX model expects int64)
    let input_ids: Vec<i64> = ids.iter().map(|&x| x as i64).collect();
    let attention_mask_i64: Vec<i64> = attention_mask.iter().map(|&x| x as i64).collect();
    let type_ids_i64: Vec<i64> = type_ids.iter().map(|&x| x as i64).collect();

    // 3. Create ndarray arrays with shape [1, seq_len]
    let input_ids_arr = Array2::from_shape_vec([1, seq_len], input_ids).ok()?;
    let attention_mask_arr = Array2::from_shape_vec([1, seq_len], attention_mask_i64).ok()?;
    let type_ids_arr = Array2::from_shape_vec([1, seq_len], type_ids_i64).ok()?;

    // 4. Create ort tensor refs
    let input_ids_tensor = TensorRef::from_array_view(&input_ids_arr).ok()?;
    let attention_mask_tensor = TensorRef::from_array_view(&attention_mask_arr).ok()?;
    let type_ids_tensor = TensorRef::from_array_view(&type_ids_arr).ok()?;

    // 5. Run inference
    //    MiniLM expects: input_ids, attention_mask, token_type_ids
    let outputs = inner
        .session
        .run(ort::inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => type_ids_tensor,
        ])
        .ok()?;

    // 6. Extract the output tensor: shape [1, seq_len, 384]
    //    The output name is typically "last_hidden_state" or the first output.
    let output_value = outputs
        .get("last_hidden_state")
        .unwrap_or(&outputs[0]);
    let hidden_states = output_value.try_extract_array::<f32>().ok()?;
    // hidden_states is ArrayViewD<f32> with shape [1, seq_len, DIMS]

    let shape = hidden_states.shape();
    if shape.len() != 3 || shape[0] != 1 || shape[2] != DIMS {
        return None;
    }

    // 7. Mean pooling with attention mask
    //    hidden_states layout: [1, seq_len, 384]
    //    Convert to contiguous owned array so we can slice it.
    let hidden_owned = hidden_states.as_standard_layout();
    let hidden_data: &[f32] = hidden_owned.as_slice().unwrap_or_else(|| {
        // This should never happen since as_standard_layout guarantees contiguous layout,
        // but we handle it defensively.
        &[]
    });
    if hidden_data.is_empty() {
        return None;
    }

    // Mean pooling: for each dimension d, sum hidden[t][d] * mask[t] / sum(mask)
    let mask_sum: f32 = attention_mask.iter().map(|&m| m as f32).sum::<f32>().max(1e-9);
    let mut pooled = vec![0.0f32; DIMS];
    for t in 0..seq_len {
        let m = attention_mask[t] as f32;
        if m > 0.0 {
            let offset = t * DIMS;
            for d in 0..DIMS {
                pooled[d] += hidden_data[offset + d] * m;
            }
        }
    }
    for d in 0..DIMS {
        pooled[d] /= mask_sum;
    }

    // 8. L2 normalize
    let norm = pooled.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
    for v in &mut pooled {
        *v /= norm;
    }

    Some(pooled)
}

/// Download a file from `url` to `dest` using reqwest.
async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    eprintln!("[embedding] Downloading {} ...", url);

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed for {url}: HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body for {url}: {e}"))?;

    // Write to a temp file first, then rename for atomicity.
    let tmp_path = dest.with_extension("tmp");
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed to write {}: {e}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, dest)
        .map_err(|e| format!("Failed to rename {} -> {}: {e}", tmp_path.display(), dest.display()))?;

    eprintln!(
        "[embedding] Downloaded {} ({} bytes)",
        dest.display(),
        bytes.len()
    );
    Ok(())
}
