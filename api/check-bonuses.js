export const config = { maxDuration: 60 };

const PROMPT = `You are checking for currently ACTIVE transfer bonus promotions (today's date matters — only
report bonuses that have not expired) from these transferable-point programs:
- Chase Ultimate Rewards (Sapphire Reserve)
- Bilt Rewards
- Capital One miles (Venture X)

Into these hotel loyalty programs: World of Hyatt, Marriott Bonvoy, IHG One Rewards, Hilton Honors,
Wyndham Rewards, Accor Live Limitless, Preferred Hotels & Resorts (I Prefer), Choice Privileges.

Search for current news on this. For each ACTIVE bonus you find, report:
- Source program -> target hotel program
- Bonus amount (e.g. "+25%")
- Expiration date
- One-line note if there's a minimum transfer or other condition

If you find nothing currently active for a given pairing, don't list it — only report real, dated,
active promotions. If nothing is active at all right now, say so plainly in one line. Keep the whole
response short — a handful of bullet points at most, no preamble, no markdown headers.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: PROMPT }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      res.status(500).json({ error: data.error.message || 'Anthropic API error' });
      return;
    }

    // Web search is a server-side tool — Anthropic runs it and interleaves
    // web_search_tool_result blocks with text blocks in one response.
    // We only need the text blocks, concatenated in order.
    const text = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    res.status(200).json({ text: text || 'No results returned.', stop_reason: data.stop_reason });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Unexpected server error' });
  }
}
