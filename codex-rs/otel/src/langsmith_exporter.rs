use opentelemetry_sdk::error::OTelSdkError;
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::logs::LogBatch;
use opentelemetry_sdk::logs::LogExporter;
use opentelemetry_sdk::logs::SdkLogRecord as LogRecord;
use reqwest::header::CONTENT_TYPE;
use reqwest::header::HeaderMap;
use reqwest::header::HeaderValue;
use serde_json::Value;
use serde_json::json;
use std::fmt;
use tracing::debug;

/// LangSmith exporter for sending traces to LangSmith API
pub struct LangsmithExporter {
    client: reqwest::Client,
    endpoint: String,
    api_key: String,
    project: Option<String>,
}

impl fmt::Debug for LangsmithExporter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LangsmithExporter")
            .field("endpoint", &self.endpoint)
            .field("project", &self.project)
            .finish()
    }
}

impl LangsmithExporter {
    pub fn new(api_key: String, endpoint: String, project: Option<String>) -> Self {
        let client = reqwest::Client::new();
        Self {
            client,
            endpoint,
            api_key,
            project,
        }
    }

    /// Convert OpenTelemetry log record to LangSmith trace format
    /// Since SdkLogRecord fields are private, we serialize the entire record as debug output
    fn convert_to_langsmith_trace(&self, record: &LogRecord) -> Value {
        // Use debug formatting to capture record data
        let record_str = format!("{record:?}");

        let mut trace = json!({
            "name": "codex_event",
            "start_time": chrono::Utc::now().to_rfc3339(),
            "inputs": {
                "record": record_str,
            },
        });

        // Add project if specified
        if let Some(ref project) = self.project {
            trace["project_name"] = json!(project);
        }

        trace
    }

    async fn send_batch(&self, batch: Vec<Value>) -> Result<(), Box<dyn std::error::Error>> {
        if batch.is_empty() {
            return Ok(());
        }

        let url = format!("{}/runs/batch", self.endpoint);
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.api_key).map_err(|e| format!("Invalid API key: {e}"))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let payload = json!({
            "post": batch,
        });

        debug!("Sending batch of {} traces to LangSmith", batch.len());

        let response = self
            .client
            .post(&url)
            .headers(headers)
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unable to read response body".to_string());
            return Err(format!("LangSmith API error {status}: {body}").into());
        }

        debug!("Successfully sent batch to LangSmith");
        Ok(())
    }
}

impl LogExporter for LangsmithExporter {
    async fn export(&self, batch: LogBatch<'_>) -> OTelSdkResult {
        let traces: Vec<Value> = batch
            .iter()
            .map(|(record, _scope)| self.convert_to_langsmith_trace(record))
            .collect();

        self.send_batch(traces)
            .await
            .map_err(|e| OTelSdkError::InternalFailure(e.to_string()))?;

        Ok(())
    }

    fn shutdown(&self) -> OTelSdkResult {
        Ok(())
    }

    fn set_resource(&mut self, _resource: &opentelemetry_sdk::Resource) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_langsmith_exporter_creation() {
        let exporter = LangsmithExporter::new(
            "test-api-key".to_string(),
            "https://api.smith.langchain.com".to_string(),
            Some("test-project".to_string()),
        );

        assert_eq!(exporter.endpoint, "https://api.smith.langchain.com");
        assert_eq!(exporter.project, Some("test-project".to_string()));
    }

    #[test]
    fn test_langsmith_exporter_without_project() {
        let exporter = LangsmithExporter::new(
            "test-api-key".to_string(),
            "https://api.smith.langchain.com".to_string(),
            None,
        );

        assert_eq!(exporter.endpoint, "https://api.smith.langchain.com");
        assert_eq!(exporter.project, None);
    }

    #[test]
    fn test_debug_impl() {
        let exporter = LangsmithExporter::new(
            "test-api-key".to_string(),
            "https://api.smith.langchain.com".to_string(),
            Some("test-project".to_string()),
        );

        let debug_str = format!("{exporter:?}");
        assert!(debug_str.contains("LangsmithExporter"));
        assert!(debug_str.contains("api.smith.langchain.com"));
        // API key should not be in debug output
        assert!(!debug_str.contains("test-api-key"));
    }
}
