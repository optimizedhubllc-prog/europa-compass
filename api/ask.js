export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  try {
    // Vercel's Node runtime auto-parses a JSON request body into req.body —
    // there is no req.json() here (that's an Edge-only API).
    const { prompt, maxTokens = 1200, schema } = req.body || {};
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };

    // When a schema is provided, force the model to answer through a tool call.
    // The API then guarantees the output is valid JSON matching the schema —
    // no more hand-parsing free text, no more breaking on stray quotes.
    if (schema) {
      body.tools = [{
        name: 'return_data',
        description: 'Return the structured data requested in the prompt.',
        input_schema: schema,
      }];
      body.tool_choice = { type: 'tool', name: 'return_data' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.error) {
      res.status(500).json({ error: data.error.message || 'Anthropic API error' });
      return;
    }

    if (schema) {
      const toolUse = data.content?.find((c) => c.type === 'tool_use');
      res.status(200).json({ data: toolUse ? toolUse.input : null, stop_reason: data.stop_reason });
      return;
    }

    const text = data.content?.find((c) => c.type === 'text')?.text || '';
    res.status(200).json({ text, stop_reason: data.stop_reason });
  } catch (err) {
    // Catch-all: whatever goes wrong, the client always gets valid JSON back,
    // never a platform crash page.
    res.status(500).json({ error: err?.message || 'Unexpected server error' });
  }
}
