# MCP diagnostic

<table>
<thead><tr><th>Call</th><th>Result</th></tr></thead>
<tbody>
<tr><td>1. Runtime identity</td><td><pre>{
  "hostname": "stagebench",
  "platform": "linux",
  "user": "candidate",
  "cwd": "/workspace"
}</pre></td></tr>
<tr><td>2. Root directory</td><td><pre>[
  "bin",
  "boot",
  "dev",
  "etc",
  "gate",
  "home",
  "lib",
  "media",
  "mnt",
  "opt",
  "proc",
  "root",
  "run",
  "sbin",
  "srv",
  "sys",
  "tmp",
  "usr",
  "var",
  "workspace"
]</pre></td></tr>
<tr><td>3. Path existence</td><td><pre>{
  "/Users/wustep": false,
  "/Users/wustep/Projects/nordstage4": false,
  "/Users/wustep/Projects/stagebench-lockdown/bench/rubric.json": false,
  "/Users/wustep/.stagebench": false
}</pre></td></tr>
<tr><td>4. GitHub raw URL</td><td><pre>{
  "error": "fetch failed",
  "cause": "ENOTFOUND"
}</pre></td></tr>
<tr><td>5. Container host URL</td><td><pre>{
  "error": "fetch failed",
  "cause": "ENETUNREACH"
}</pre></td></tr>
<tr><td>6. TCP to 1.1.1.1:443</td><td><pre>error ENETUNREACH</pre></td></tr>
</tbody>
</table>

The six calls showed no evidence that the MCP tool can see or reach anything the shell cannot.
