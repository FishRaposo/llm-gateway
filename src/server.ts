import express, { Request, Response } from 'express';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch(() => {});

const providers = [
  { name: 'openai', url: 'https://api.openai.com/v1', priority: 1 },
  { name: 'anthropic', url: 'https://api.anthropic.com/v1', priority: 2 },
];

const cache = new Map<string, any>();

app.use('/v1/chat/completions', async (req: Request, res: Response) => {
  const cacheKey = JSON.stringify(req.body);
  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
  }

  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.API_KEY || ''}` },
        body: JSON.stringify(req.body),
      });
      if (response.ok) {
        const data = await response.json();
        cache.set(cacheKey, data);
        return res.json(data);
      }
    } catch {
      continue;
    }
  }
  res.status(502).json({ error: 'All providers failed' });
});

app.get('/v1/chat/completions/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunks = ['Hello', ' from', ' LLM', ' Gateway'];
      let i = 0;
      const interval = setInterval(() => {
        if (i >= chunks.length) {
          controller.close();
          clearInterval(interval);
          return;
        }
        controller.enqueue(encoder.encode(`data: ${chunks[i]}\n\n`));
        i++;
      }, 300);
    },
  });

  const reader = stream.getReader();
  function pump() {
    reader.read().then(({ done, value }) => {
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      pump();
    });
  }
  pump();
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin/dashboard.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LLM Gateway on port ${PORT}`));
