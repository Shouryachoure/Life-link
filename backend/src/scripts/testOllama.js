async function main() {
  const start = Date.now();
  console.log('Sending request to local Ollama qwen3:4b...');
  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:4b',
      prompt: 'Namaste! Who are you in one sentence?',
      stream: false,
    }),
  });
  const data = await res.json();
  const latency = Date.now() - start;
  console.log('STATUS:', res.status);
  console.log('REPLY:', data.response?.trim());
  console.log('LATENCY MS:', latency);
  console.log('EVAL COUNT:', data.eval_count);
  console.log('EVAL DURATION (ns):', data.eval_duration);
  if (data.eval_duration && data.eval_count) {
    const tps = (data.eval_count / (data.eval_duration / 1e9)).toFixed(2);
    console.log('TOKENS PER SECOND:', tps);
  }
}

main().catch(console.error);
