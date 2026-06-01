// api/debug.js — temporary diagnostic endpoint
// Visit https://your-app.vercel.app/api/debug to check health
// DELETE this file after confirming everything works.

module.exports = async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY;

    const report = {
        timestamp: new Date().toISOString(),
        node_version: process.version,
        api_key_present: !!key,
        api_key_prefix: key ? key.substring(0, 14) + '...' : 'MISSING',
        api_key_length: key ? key.length : 0,
        environment: process.env.VERCEL_ENV || 'unknown',
    };

    // Try a minimal Anthropic SDK call to confirm the key is valid
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const AnthropicClass = Anthropic.default || Anthropic;
        const client = new AnthropicClass({ apiKey: key });

        const response = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 20,
            messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
        });

        report.sdk_test = 'PASSED';
        report.sdk_response = response.content[0]?.text || '(empty)';
        report.stop_reason = response.stop_reason;

    } catch (err) {
        report.sdk_test = 'FAILED';
        report.sdk_error_type = err.constructor?.name || 'Error';
        report.sdk_error_msg = err.message;
        report.sdk_error_status = err.status || null;
    }

    res.status(200).json(report);
};