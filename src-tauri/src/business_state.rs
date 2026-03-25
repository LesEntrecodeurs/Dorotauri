/// Infer a business state from a status line. Returns None if no pattern matches.
pub fn infer_business_state(status_line: &str) -> Option<String> {
    let lower = status_line.to_lowercase();

    // More specific patterns first
    if lower.contains("running tests") || (lower.contains("test") && lower.contains("running")) {
        return Some("testing".to_string());
    }
    if lower.contains("reviewing") || lower.contains("code review") {
        return Some("in review".to_string());
    }
    if lower.contains("building") || lower.contains("compiling") {
        return Some("building".to_string());
    }
    if lower.contains("deploying") {
        return Some("deploying".to_string());
    }
    if lower.contains("waiting for") || lower.contains("blocked by") {
        return Some("blocked".to_string());
    }
    if lower.contains("writing") || lower.contains("editing") || lower.contains("creating file") {
        return Some("coding".to_string());
    }
    if lower.contains("reading") || lower.contains("analyzing") || lower.contains("exploring") {
        return Some("analyzing".to_string());
    }
    if lower.contains("installing") || lower.contains("downloading") {
        return Some("installing".to_string());
    }
    if lower.contains("committing") || lower.contains("pushing") || lower.contains("git push") {
        return Some("committing".to_string());
    }

    None
}
