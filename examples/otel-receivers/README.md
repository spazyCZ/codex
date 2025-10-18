# OpenTelemetry Receivers Examples

This directory contains examples of OpenTelemetry receivers that accept log events from Codex via both HTTP and gRPC protocols.

## Python Example

### Installation
```bash
pip install opentelemetry-api opentelemetry-sdk Flask grpcio grpcio-tools
```

### Example Code
```python
from flask import Flask, request
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource

app = Flask(__name__)

@app.route('/logs', methods=['POST'])
def receive_logs():
    log_data = request.json
    # Process log data
    return 'Logs received', 200

if __name__ == '__main__':
    app.run(port=5000)
```

### Running the Application
```bash
python app.py
```

## Go Example

### Installation
```bash
go get -u google.golang.org/grpc
```

### Example Code
```go
package main

import (
	"context"
	"log"
	"net"
	"google.golang.org/grpc"
)

type server struct{}

func (s *server) ReceiveLogs(ctx context.Context, in *LogRequest) (*LogResponse, error) {
	// Process log data
	return &LogResponse{Message: "Logs received"}, nil
}

func main() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}
	grpcServer := grpc.NewServer()
	// Register the server
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
```

### Running the Application
```bash
go run main.go
```

## Node.js Example

### Installation
```bash
npm install express @grpc/grpc-js
```

### Example Code
```javascript
const express = require('express');
const grpc = require('@grpc/grpc-js');

const app = express();
app.use(express.json());

app.post('/logs', (req, res) => {
    const logData = req.body;
    // Process log data
    res.send('Logs received');
});

app.listen(5000, () => {
    console.log('HTTP server running on port 5000');
});
```

### Running the Application
```bash
node app.js
```
