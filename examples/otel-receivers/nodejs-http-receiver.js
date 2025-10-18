const express = require('express');
const bodyParser = require('body-parser');
const protobuf = require('protobufjs');

const app = express();
const port = 4318;

app.use(bodyParser.json());

// Load the Protobuf schema for OTLP
protobuf.load('path/to/otlp.proto', (err, root) => {
    if (err) throw err;
    const LogRecord = root.lookupType('opentelemetry.proto.logs.v1.LogRecord');
});

app.post('/v1/logs', (req, res) => {
    try {
        const { contentType, data } = req;
        let logEvents;

        // Check content type for parsing
        if (contentType === 'application/json') {
            logEvents = req.body;
        } else if (contentType === 'application/x-protobuf') {
            logEvents = LogRecord.decode(data);
        } else {
            return res.status(400).send('Unsupported content type');
        }

        // Display incoming log events
        logEvents.forEach(event => {
            console.log('Received log event:', event);
            console.log('Metadata:', {
                conversationId: event.metadata.conversation.id,
                model: event.metadata.model,
                slug: event.metadata.slug
            });
            console.log('Event Type:', event.eventType);
        });

        res.status(200).send('Logs received');
    } catch (error) {
        console.error('Error processing log events:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`HTTP OpenTelemetry receiver listening on port ${port}`);
});
