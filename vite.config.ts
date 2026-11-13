import { appendFileSync, mkdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

/** Geliştirmede tarayıcıdan gelen logları logs/dev.log dosyasına yazar (bkz. src/devlog.ts). */
function devLogPlugin(): Plugin {
  const dir = 'logs';
  const file = `${dir}/dev.log`;
  return {
    name: 'vapur-devlog',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return;
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `\n=== dev sunucusu başladı ${new Date().toISOString()} ===\n`);
      server.middlewares.use('/__devlog', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        req.on('end', () => {
          try {
            const entries = JSON.parse(body) as { t: string; level: string; msg: string }[];
            appendFileSync(file, entries.map((e) => `${e.t} [${e.level}] ${e.msg}`).join('\n') + '\n');
          } catch {
            appendFileSync(file, `${new Date().toISOString()} [devlog] bozuk gövde: ${body.slice(0, 200)}\n`);
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [devLogPlugin()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
