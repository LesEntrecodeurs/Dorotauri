use bytes::Bytes;
use std::collections::VecDeque;
use std::sync::Mutex;
use tokio::sync::broadcast;

const CATCHUP_BUFFER_MAX_BYTES: usize = 64 * 1024; // 64KB

pub struct PtySession {
    output_tx: broadcast::Sender<Bytes>,
    recent_output: Mutex<CatchUpBuffer>,
}

struct CatchUpBuffer {
    chunks: VecDeque<Bytes>,
    total_bytes: usize,
}

impl CatchUpBuffer {
    fn new() -> Self {
        CatchUpBuffer {
            chunks: VecDeque::new(),
            total_bytes: 0,
        }
    }

    fn push(&mut self, data: Bytes) {
        self.total_bytes += data.len();
        self.chunks.push_back(data);

        while self.total_bytes > CATCHUP_BUFFER_MAX_BYTES {
            if let Some(old) = self.chunks.pop_front() {
                self.total_bytes -= old.len();
            } else {
                break;
            }
        }
    }

    fn drain(&self) -> Vec<Bytes> {
        self.chunks.iter().cloned().collect()
    }

    fn clear(&mut self) {
        self.chunks.clear();
        self.total_bytes = 0;
    }
}

impl PtySession {
    pub fn new(output_tx: broadcast::Sender<Bytes>) -> Self {
        PtySession {
            output_tx,
            recent_output: Mutex::new(CatchUpBuffer::new()),
        }
    }

    pub fn push_output(&self, data: Bytes) {
        self.recent_output.lock().unwrap().push(data.clone());
        let _ = self.output_tx.send(data);
    }

    pub fn get_catchup(&self) -> Vec<Bytes> {
        self.recent_output.lock().unwrap().drain()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Bytes> {
        self.output_tx.subscribe()
    }

    pub fn clear_buffer(&self) {
        self.recent_output.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session() -> PtySession {
        let (tx, _) = broadcast::channel(256);
        PtySession::new(tx)
    }

    #[test]
    fn test_push_and_catchup() {
        let session = make_session();
        session.push_output(Bytes::from("hello "));
        session.push_output(Bytes::from("world"));

        let catchup = session.get_catchup();
        assert_eq!(catchup.len(), 2);
        assert_eq!(catchup[0], Bytes::from("hello "));
        assert_eq!(catchup[1], Bytes::from("world"));
    }

    #[test]
    fn test_catchup_buffer_eviction() {
        let session = make_session();
        let big_chunk = Bytes::from(vec![b'x'; 32 * 1024]); // 32KB each
        session.push_output(big_chunk.clone()); // 32KB
        session.push_output(big_chunk.clone()); // 64KB
        session.push_output(big_chunk.clone()); // 96KB → evicts first chunk

        let catchup = session.get_catchup();
        let total: usize = catchup.iter().map(|c| c.len()).sum();
        assert!(total <= CATCHUP_BUFFER_MAX_BYTES);
        assert_eq!(catchup.len(), 2);
    }

    #[test]
    fn test_subscriber_receives_pushed_data() {
        let session = make_session();
        let mut rx = session.subscribe();

        session.push_output(Bytes::from("data"));
        let received = rx.try_recv().unwrap();
        assert_eq!(received, Bytes::from("data"));
    }

    #[test]
    fn test_clear_buffer() {
        let session = make_session();
        session.push_output(Bytes::from("data"));
        assert!(!session.get_catchup().is_empty());

        session.clear_buffer();
        assert!(session.get_catchup().is_empty());
    }

    #[test]
    fn test_no_subscribers_does_not_panic() {
        let session = make_session();
        session.push_output(Bytes::from("data"));
    }
}
