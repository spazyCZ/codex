#!/usr/bin/env node

/**
 * Simple OpenTelemetry HTTP Receiver for Codex
 * 
 * This receiver accepts OTLP log data via HTTP in JSON format.
 * It's designed to work with Codex's OpenTelemetry export feature.
 * 
 * Usage:
 *   npm install express
 *   node nodejs-http-receiver-simple.js
 * 
 * Configure Codex with:
 *   [otel]
 *   environment = "dev"
 *   exporter = "otlp-http"
 *   
 *   [otel.exporter.otlp-http]
 *   endpoint = "http://localhost:4318"
 *   protocol = "json"
 */

const express = require('express');
const app = express();
const PORT = 4318;

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Parse binary protobuf bodies (if needed)
app.use(express.raw({ type: 'application/x-protobuf', limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// OTLP logs endpoint (standard path)
app.post('/v1/logs', (req, res) => {
  try {
    const contentType = req.get('content-type') || '';
    
    console.log('\n=== Received OTLP Logs ===');
    console.log('Content-Type:', contentType);
    console.log('Time:', new Date().toISOString());
    
    if (contentType.includes('application/json')) {
      // Handle JSON payload
      const logsData = req.body;
      
      if (logsData.resourceLogs) {
        logsData.resourceLogs.forEach((resourceLog, idx) => {
          console.log(`\n--- Resource Log ${idx + 1} ---`);
          
          // Resource attributes (service.name, service.version, etc.)
          if (resourceLog.resource && resourceLog.resource.attributes) {
            console.log('Resource Attributes:');
            resourceLog.resource.attributes.forEach(attr => {
              const value = attr.value.stringValue || attr.value.intValue || attr.value.boolValue || attr.value;
              console.log(`  ${attr.key}: ${value}`);
            });
          }
          
          // Scope logs (individual log records)
          if (resourceLog.scopeLogs) {
            resourceLog.scopeLogs.forEach(scopeLog => {
              if (scopeLog.logRecords) {
                console.log(`\nLog Records (${scopeLog.logRecords.length} total):`);
                
                scopeLog.logRecords.forEach((logRecord, logIdx) => {
                  console.log(`\n  Log Record ${logIdx + 1}:`);
                  console.log(`    Time: ${new Date(Number(logRecord.timeUnixNano) / 1000000).toISOString()}`);
                  console.log(`    Severity: ${logRecord.severityText || logRecord.severityNumber || 'INFO'}`);
                  
                  // Body (main log message)
                  if (logRecord.body) {
                    const bodyValue = logRecord.body.stringValue || JSON.stringify(logRecord.body);
                    console.log(`    Body: ${bodyValue}`);
                  }
                  
                  // Attributes (Codex-specific metadata)
                  if (logRecord.attributes) {
                    console.log('    Attributes:');
                    logRecord.attributes.forEach(attr => {
                      const value = attr.value.stringValue || 
                                  attr.value.intValue || 
                                  attr.value.boolValue || 
                                  attr.value.doubleValue ||
                                  JSON.stringify(attr.value);
                      console.log(`      ${attr.key}: ${value}`);
                    });
                  }
                });
              }
            });
          }
        });
      }
      
      // Success response (required by OTLP spec)
      res.status(200).json({});
      
    } else if (contentType.includes('application/x-protobuf')) {
      // Handle binary protobuf payload
      console.log('Received binary protobuf payload (not decoded in this simple example)');
      console.log('Payload size:', req.body.length, 'bytes');
      
      // For production, you'd decode with @opentelemetry/otlp-transformer
      res.status(200).json({});
      
    } else {
      console.error('Unsupported content type:', contentType);
      res.status(415).json({ error: 'Unsupported Media Type' });
    }
    
  } catch (error) {
    console.error('Error processing logs:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   OpenTelemetry HTTP Receiver for Codex                  ║
╚═══════════════════════════════════════════════════════════╝

🚀 Server running on http://localhost:${PORT}
📊 Logs endpoint: http://localhost:${PORT}/v1/logs
❤️  Health check: http://localhost:${PORT}/health

Configure Codex to send logs here:

[otel]
environment = "dev"
exporter = "otlp-http"

[otel.exporter.otlp-http]
endpoint = "http://localhost:${PORT}"
protocol = "json"

Waiting for log events...
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});
