export const config = { maxDuration: 60 };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const { prompt, maxTokens = 1200, schema } = await req.json();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
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

  // Previously a failed Anthropic API call (bad key, rate limit, invalid
  // model, etc.) fell through silently as an empty string. Surface it.
  if (data.error) {
    return new Response(JSON.stringify({ error: data.error.message || 'Anthropic API error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (schema) {
    const toolUse = data.content?.find((c) => c.type === 'tool_use');
    return new Response(JSON.stringify({
      data: toolUse ? toolUse.input : null,
      stop_reason: data.stop_reason,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const text = data.content?.find((c) => c.type === 'text')?.text || '';
  return new Response(JSON.stringify({ text, stop_reason: data.stop_reason }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
