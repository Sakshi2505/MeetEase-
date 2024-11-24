require('dotenv').config();
const express = require("express");
const multer = require('multer');
const fs = require('fs');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');


// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
console.log('Gemini API Key loaded:', process.env.GEMINI_API_KEY ? 'Present' : 'Missing');

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(mp3|wav|m4a|ogg)$/)) {
      return cb(new Error('Only audio files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Middleware
app.use(bodyParser.json());
app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Load HTML files
try {
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });
  app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'about.html'));
  });
  app.get('/analyze', (req, res) => {
    res.sendFile(path.join(__dirname, 'analyze.html'));
  });
  app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'results.html'));
  });
} catch (error) {
  console.error("Error setting up routes:", error);
  process.exit(1);
}

// Add this near the top with other configurations
const TIMEOUT_DURATION = 60000; // 60 seconds in milliseconds

// Modify the upload endpoint to include timeout
app.post("/upload", upload.single("audio"), async (req, res) => {
    // Add timeout promise
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 60 seconds')), TIMEOUT_DURATION)
    );

    try {
        // Wrap the existing logic in Promise.race
        await Promise.race([
            (async () => {
                console.log('Upload request received');
                
                if (!req.file) {
                    console.log('No file in request');
                    return res.status(400).json({ error: "No audio file uploaded" });
                }

                // Create form data for Flask API
                const formData = new FormData();
                const file = new File([req.file.buffer], req.file.originalname, {
                    type: req.file.mimetype
                });
                formData.append('file', file);

                // Add logging for Flask API call
                console.log(`Attempting to call Flask API at: ${process.env.URL}/transcribe`);
                
                // Call Flask API for transcription
                const flaskResponse = await fetch(`${process.env.URL}/transcribe`, {
                    method: 'POST',
                    body: formData
                });

                if (!flaskResponse.ok) {
                    const errorText = await flaskResponse.text();
                    console.error('Flask API Error:', {
                        status: flaskResponse.status,
                        statusText: flaskResponse.statusText,
                        response: errorText
                    });
                    throw new Error(`Flask API request failed: ${flaskResponse.status} ${flaskResponse.statusText}`);
                }

                const transcriptionResult = await flaskResponse.json();
                const transcript = transcriptionResult.transcription;

                // Generate summary using Gemini
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const prompt = `
Please analyze the following transcript and provide:
1. A concise summary of the main points
2. A list of key takeaways

Format the response exactly like this:
**Summary:** [Your summary here]
**Key Points:**
* [First key point]
* [Second key point]
* [Third key point]

Transcript: "${transcript}"
`;
                
                const result = await model.generateContent(prompt);
                const summary = result.response.text();

                // Generate key topics using Gemini
                const topicsPrompt = `Please identify and list the main topics discussed in this transcript: "${transcript}"`;
                const topicsResult = await model.generateContent(topicsPrompt);
                const topics = topicsResult.response.text();
                

                console.log('Processing complete, sending response');
                return res.json({
                    success: true,
                    transcript: transcript,
                    summary: summary,
                    topics: topics
                });
            })(),
            timeoutPromise
        ]);
    } catch (error) {
        if (error.message.includes('Request timeout')) {
            return res.status(504).json({
                error: "Request timed out",
                details: "Processing took longer than 60 seconds"
            });
        }
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            type: error.type,
            cause: error.cause,
            stack: error.stack // Add stack trace for better debugging
        });
        
        let errorMessage = "Error processing audio file";
        let statusCode = 500;

        if (error.code === 'ECONNRESET') {
            errorMessage = "Connection reset. Please try again.";
            statusCode = 503;
        } else if (error.message.includes('File size exceeds')) {
            errorMessage = "File too large. Maximum size is 25MB";
            statusCode = 413;
        } else if (error.message.includes('Cannot access uploaded file')) {
            errorMessage = "File upload failed";
            statusCode = 400;
        } else if (error.message.includes('Flask API request failed')) {
            errorMessage = "Transcription service unavailable";
            statusCode = 503;
        }

        res.status(statusCode).json({ 
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (req.file?.path) {
            try {
                await fs.promises.unlink(req.file.path);
                console.log('File cleanup successful');
            } catch (err) {
                console.error('Error during file cleanup:', err);
            }
        }
    }
});

// Add this test endpoint
app.get("/test-openai", async (req, res) => {
    try {
        const models = await openai.models.list();
        res.json({
            success: true,
            message: "API key is working",
            models: models.data
        });
    } catch (error) {
        console.error('OpenAI API Error:', error);
        res.status(500).json({
            success: false,
            error: "API key validation failed",
            message: error.message
        });
    }
});

// Add error handling middleware
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({
        error: "Server error",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// Modify the test-gemini endpoint
app.get("/test-gemini", async (req, res) => {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 60 seconds')), TIMEOUT_DURATION)
    );

    try {
        await Promise.race([
            (async () => {
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const result = await model.generateContent("Hello, are you working?");
                const response = await result.response.text();
                res.json({
                    success: true,
                    message: "Gemini API is working",
                    response: response
                });
            })(),
            timeoutPromise
        ]);
    } catch (error) {
        if (error.message.includes('Request timeout')) {
            return res.status(504).json({
                error: "Request timed out",
                details: "Operation took longer than 60 seconds"
            });
        }
        console.error('Gemini API Error:', error);
        res.status(500).json({
            success: false,
            error: "Gemini API validation failed",
            message: error.message
        });
    }
});

// For debugging
app.get('/debug', (req, res) => {
    const cssPath = path.join(__dirname, 'public/css/styles.css');
    res.json({
        cssExists: require('fs').existsSync(cssPath),
        publicDir: require('fs').readdirSync(path.join(__dirname, 'public')),
        cssDir: require('fs').readdirSync(path.join(__dirname, 'public/css'))
    });
});

// Add a catch-all route for HTML files
app.get('/:page.html', (req, res) => {
    const page = req.params.page;
    res.sendFile(path.join(__dirname, `${page}.html`));
});


module.exports = app;

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}
