// Static report renderers. Pure functions over run data + scored evaluations;
// the CLI writes their output to public/reports and runs/<id>/evaluations.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

// Issues are schema-constrained to {severity, title, detail} going forward, but
// runs sealed before that ship 14 different shapes (bare strings,
// {title, detail}, {area, evidence, summary}, {criterion, description}, …).
// Read whatever keys exist so an archived issue never renders as
// "[object Object]".
function formatIssue(issue) {
  if (issue && typeof issue === 'object') {
    const str = (value) => (typeof value === 'string' ? value.trim() : '')
    const title = str(issue.title) || str(issue.issue)
    const detail = str(issue.detail) || str(issue.evidence) || str(issue.description) || str(issue.summary)
    const severity = str(issue.severity)
    const body = title && detail ? `${title}: ${detail}` : (title || detail)
    if (body) return { severity, body }
  }
  return { severity: '', body: String(issue ?? '') }
}

// Generated-audio declarations aren't schema-constrained, so runs use varying
// shapes: {name, kind, notes}, {kind, description}, or a bare string. Pull a
// display label plus an optional secondary detail from whatever keys exist,
// so an unexpected shape never stringifies to "[object Object]".
function describeGeneratedSource(source) {
  if (!source || typeof source !== 'object') return { label: String(source ?? ''), detail: '' }
  const label = source.name ?? source.kind ?? source.type ?? source.label ?? source.source ?? 'Generated source'
  const detail = [source.method, source.description, source.kind, source.notes]
    .find((value) => typeof value === 'string' && value.trim() && value !== label) ?? ''
  return { label, detail }
}

function formatDate(value) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))
}

function floorScore(value) {
  return Math.floor(Number(value))
}

function stageSummaryRow(stage, evaluation) {
  if (!evaluation) return `<tr><td>Phase ${stage.number}</td><td>${escapeHtml(stage.status)}</td><td>—</td></tr>`
  return `<tr><td>Phase ${stage.number}</td><td>${escapeHtml(evaluation.stageName)}</td><td><strong>${floorScore(evaluation.score)}</strong>/100</td></tr>`
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function audioDetails(audio) {
  const generated = audio.generatedSources?.length
    ? `<div><dt>Generated sound sources</dt><dd><ul>${audio.generatedSources.map((source) => {
        const { label, detail } = describeGeneratedSource(source)
        return `<li><strong>${escapeHtml(label)}</strong>${detail ? ` — ${escapeHtml(detail)}` : ''}</li>`
      }).join('')}</ul></dd></div>`
    : '<div><dt>Generated sound sources</dt><dd>None declared</dd></div>'
  const samples = audio.sampleSources?.length
    ? `<div><dt>Sample provenance</dt><dd><ul>${audio.sampleSources.map((source) => `<li><strong>${escapeHtml(source.name)}</strong> — ${escapeHtml(source.source)} · ${escapeHtml(source.license)}${source.notes ? `<br><span>${escapeHtml(source.notes)}</span>` : ''}</li>`).join('')}</ul></dd></div>`
    : '<div><dt>Recorded sample provenance</dt><dd>No recorded or external sample sources declared</dd></div>'
  // A count and a total, not dozens of paths with byte sizes: the strategy and
  // provenance lines are what the honesty contract turns on.
  const files = audio.detectedFiles?.length
    ? `<div><dt>Bundled audio</dt><dd>${audio.detectedFiles.length} file${audio.detectedFiles.length === 1 ? '' : 's'} · ${formatBytes(audio.detectedFiles.reduce((total, file) => total + file.bytes, 0))}</dd></div>`
    : '<div><dt>Bundled audio</dt><dd>None detected</dd></div>'
  const notes = audio.notes?.length
    ? `<div><dt>Notes</dt><dd><ul>${audio.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></dd></div>`
    : ''
  return `<dl class="audio-details"><div><dt>Audio strategy</dt><dd>${escapeHtml(audio.strategy)}</dd></div>${generated}${samples}${files}${notes}</dl>`
}

// Audio provenance only. The package-manifest tables this section used to
// carry ("Application libraries", "Development and test tooling") listed react
// and vite for every run and never distinguished two of them; what the honesty
// contract turns on is where the sound comes from.
function implementationSection(details) {
  if (!details?.phases?.length) return ''
  return `<section class="overview implementation-details" id="implementation-details">
      <div class="section-intro">
        <div><span>Honesty disclosure</span><h2>Audio provenance</h2></div>
        <a href="implementation-details.json">View JSON</a>
      </div>
      <p>Audio files are detected from the sealed artifact; sound-generation methods and sample provenance are declared by the candidate in <code>IMPLEMENTATION_DETAILS.json</code>.</p>
      ${details.phases.map((phase) => `<section class="implementation-phase">
        <header><span>Phase ${phase.phase}</span><h3>${escapeHtml(phase.phaseName)}</h3></header>
        ${audioDetails(phase.audio)}
      </section>`).join('')}
    </section>`
}

// A criterion is either judged (0-4) or computed from reported measurements.
// Show the measurements inline so a reader can re-derive the score.
function criterionValue(criterion) {
  if (criterion.scoring !== 'computed') return `${criterion.rating}/4`
  return `<ul class="measurements">${criterion.measurements.map((measurement) => `<li><code>${escapeHtml(measurement.id)}</code> <span>${escapeHtml(String(measurement.value ?? '—'))}</span>${measurement.score === null ? '' : ` <b>${floorScore(measurement.score)}</b>`}</li>`).join('')}</ul>`
}

function criterionRows(category) {
  return category.criteria.map((criterion) => `
    <tr>
      <td><strong>${escapeHtml(criterion.label)}</strong>${criterion.scoring === 'computed' ? ' <span class="pill-computed">computed</span>' : ''}</td>
      <td>${criterionValue(criterion)}</td>
      <td>${floorScore(criterion.score)}</td>
      <td><ul>${criterion.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></td>
    </tr>`).join('')
}

// Panel fidelity is scored once for the whole run rather than per phase, so it
// gets its own section rather than sitting inside a phase.
function runAxisSection(axis) {
  if (!axis) return ''
  return `
  <section class="stage-report" id="run-axis">
    <header class="stage-heading">
      <div><span>Scored once &middot; ${escapeHtml(axis.scoredAgainst ?? 'final sealed phase')}</span><h2>${escapeHtml(axis.label)}</h2></div>
      <div class="stage-score"><strong>${floorScore(axis.score)}</strong><span>/100 &middot; ${axis.weight}% of the run</span></div>
    </header>
    ${axis.hardGate?.tripped?.length ? `<p class="gate gate-fail">Hard gate tripped by ${axis.hardGate.tripped.map(escapeHtml).join(', ')} &middot; raw ${floorScore(axis.rawScore)} capped at ${axis.hardGate.scoreCap}</p>` : ''}
    <table class="criteria-table">
      <thead><tr><th>Criterion</th><th>Measured / rated</th><th>Score</th><th>Evidence</th></tr></thead>
      <tbody>${criterionRows(axis)}</tbody>
    </table>
  </section>`
}

function stageSection(evaluation) {
  const checks = evaluation.technicalGate.checks ?? []
  return `
  <section class="stage-report" id="stage-${evaluation.stage}">
    <header class="stage-heading">
      <div><span>Phase ${evaluation.stage}</span><h2>${escapeHtml(evaluation.stageName)}</h2></div>
      <div class="stage-score"><strong>${floorScore(evaluation.score)}</strong><span>/100</span></div>
    </header>

    <p class="summary">${escapeHtml(evaluation.summary)}</p>

    <section>
      <h3>Axis scores</h3>
      <table>
        <thead><tr><th>Axis</th><th>Weight</th><th>Score</th><th>Contribution</th></tr></thead>
        <tbody>${evaluation.categories.map((category) => `<tr><td>${escapeHtml(category.label)}</td><td>${category.weight}%</td><td><strong>${floorScore(category.score)}</strong></td><td>${floorScore(category.contribution)}</td></tr>`).join('')}</tbody>
      </table>
    </section>

    <section class="issues">
      <h3>Priority issues</h3>
      ${evaluation.issues.length > 0 ? `<ol>${evaluation.issues.map((issue) => {
        const { severity, body } = formatIssue(issue)
        return `<li>${severity ? `<span class="sev sev-${escapeHtml(severity)}">${escapeHtml(severity)}</span> ` : ''}${escapeHtml(body)}</li>`
      }).join('')}</ol>` : '<p>No issues were recorded.</p>'}
    </section>

    <section>
      <h3>Technical gate</h3>
      <p class="gate ${evaluation.technicalGate.passed ? 'gate-pass' : 'gate-fail'}">${evaluation.technicalGate.passed ? 'Passed' : `Failed · score capped at ${evaluation.technicalGate.scoreCap}`}</p>
      <table>
        <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>${checks.map((check) => `<tr><td>${escapeHtml(check.label ?? check.id)}</td><td>${check.passed ? 'Pass' : 'Fail'}</td><td>${escapeHtml(check.detail ?? check.command ?? '')}</td></tr>`).join('')}</tbody>
      </table>
    </section>

    <details>
      <summary>Criterion ratings and evidence</summary>
      ${evaluation.categories.map((category) => `
        <section class="criteria-group">
          <h3>${escapeHtml(category.label)}</h3>
          <table class="criteria-table">
            <thead><tr><th>Criterion</th><th>Rating</th><th>Score</th><th>Evidence</th></tr></thead>
            <tbody>${criterionRows(category)}</tbody>
          </table>
        </section>`).join('')}
    </details>
  </section>`
}

export function renderRunReportHtml(run, evaluations, implementationDetails) {
  const aggregate = run.evaluation
  const runTitle = run.title ?? run.model
  const generatedAt = new Date().toISOString()
  // One model across the run, or nothing — a mixed set is exactly the drift the
  // pin exists to prevent, so don't imply consistency the record doesn't have.
  const evaluatorModels = [...new Set(evaluations.map((evaluation) => evaluation.evaluatorModel).filter(Boolean))]
  const evaluatorModel = evaluatorModels.length === 1 ? evaluatorModels[0] : null
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="data:," />
  <title>${escapeHtml(runTitle)} · Stagebench evaluation</title>
  <style>
    :root { color-scheme: light; --red:#a51f24; --red-dark:#70191e; --ink:#211c1d; --muted:#665d5f; --line:#d6cdcf; --surface:#f5f3f3; --panel:#fff; --green:#2c7a45; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:var(--surface); color:var(--ink); font:14px/1.55 Inter, ui-sans-serif, system-ui, sans-serif; }
    a { color:var(--red-dark); }
    .report-header { padding:42px max(24px,calc((100% - 1080px)/2)); background:var(--red); color:#fff; }
    .report-header small { display:block; margin-bottom:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .report-header h1 { max-width:760px; margin:0; font-size:clamp(34px,6vw,62px); line-height:1; letter-spacing:-.03em; text-wrap:balance; }
    .report-header p { max-width:70ch; margin:18px 0 0; color:#ffecec; }
    .aggregate { display:flex; align-items:baseline; gap:9px; margin-top:28px; }
    .aggregate strong { font-size:48px; line-height:1; }
    .aggregate span { font-weight:800; text-transform:uppercase; }
    main { width:min(1080px,calc(100% - 32px)); margin:0 auto; padding:42px 0 72px; }
    .overview, .stage-report { margin-bottom:34px; padding:26px; background:var(--panel); border:1px solid var(--line); border-radius:12px; }
    h2,h3,h4 { text-wrap:balance; } h2 { margin:0; font-size:28px; } h3 { margin:0 0 12px; font-size:15px; } h4 { margin:0 0 10px; color:var(--muted); font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { color:var(--muted); font-size:11px; text-align:left; text-transform:uppercase; }
    th,td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; }
    .section-intro { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; } .section-intro span,.implementation-phase header span { color:var(--red); font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; } .section-intro a { font-size:12px; font-weight:800; }
    .implementation-details > p { max-width:76ch; color:var(--muted); }
    .implementation-phase { padding:22px 0; border-top:1px solid var(--line); } .implementation-phase:last-child { padding-bottom:0; } .implementation-phase h3 { margin:2px 0 14px; font-size:18px; }
    .implementation-grid { display:grid; grid-template-columns:minmax(0,.8fr) minmax(0,1.05fr) minmax(0,1.4fr); gap:24px; }
    .library-list { margin:0; padding:0; list-style:none; } .library-list li { display:flex; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px solid #eee8e9; } .library-list span { color:var(--muted); font-size:11px; }
    .audio-details { margin:0; } .audio-details > div { display:grid; grid-template-columns:130px minmax(0,1fr); gap:12px; padding:5px 0; border-bottom:1px solid #eee8e9; } .audio-details dt { color:var(--muted); font-size:11px; font-weight:800; } .audio-details dd { margin:0; } .audio-details ul { margin:0; padding-left:17px; } .audio-details span { color:var(--muted); font-size:12px; } .empty-detail { color:var(--muted); }
    .stage-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; padding-bottom:18px; border-bottom:1px solid var(--line); }
    .stage-heading > div:first-child span { color:var(--red); font-size:11px; font-weight:800; text-transform:uppercase; }
    .stage-score { display:flex; align-items:baseline; gap:5px; color:var(--red-dark); } .stage-score strong { font-size:34px; line-height:1; } .stage-score span { font-size:11px; font-weight:800; text-transform:uppercase; }
    .summary { max-width:78ch; margin:20px 0 26px; color:#3f383a; }
    .report-columns { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr); gap:28px; }
    .findings { margin:0; padding:0; list-style:none; } .findings li { padding:0 0 12px; } .findings strong,.findings span { display:block; } .findings span { margin-top:3px; color:var(--muted); font-size:12px; }
    .issues { margin:28px 0; padding:20px; background:#f8eded; border-radius:8px; } .issues ol { margin:0; padding-left:20px; } .issues li + li { margin-top:8px; }
    .measurements { margin:0; padding:0; list-style:none; font-size:12px; } .measurements li { display:flex; gap:6px; align-items:baseline; padding:1px 0; } .measurements code { font-size:11px; } .measurements span { color:var(--muted); } .measurements b { margin-left:auto; }
    .pill-computed { display:inline-block; padding:1px 6px; border-radius:999px; background:#e3eef0; color:#0f6e7a; font-size:9.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; }
    .sev { display:inline-block; margin-right:6px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; vertical-align:1px; }
    .sev-critical { background:#821b20; color:#fff; } .sev-major { background:#e6d0a8; color:#6a4a09; } .sev-minor { background:#e2dcdd; color:#5b5354; }
    .gate { display:inline-block; margin:0 0 12px; padding:5px 9px; border-radius:999px; font-size:11px; font-weight:800; text-transform:uppercase; } .gate-pass { background:#e3f2e7; color:#225d34; } .gate-fail { background:#f5dfe0; color:#821b20; }
    details { margin-top:26px; border-top:1px solid var(--line); } summary { padding:18px 0; font-weight:800; cursor:pointer; } .criteria-group + .criteria-group { margin-top:24px; } .criteria-table ul { margin:0; padding-left:18px; } .criteria-table li + li { margin-top:6px; }
    footer { padding:24px; background:var(--ink); color:#cfc7c9; font-size:11px; text-align:center; }
    @media (max-width:800px) { .implementation-grid { grid-template-columns:1fr; } }
    @media (max-width:720px) { .report-columns { grid-template-columns:1fr; } .overview,.stage-report { padding:18px; } .stage-heading { align-items:flex-start; flex-direction:column; } .section-intro { align-items:flex-start; flex-direction:column; } .audio-details > div { grid-template-columns:1fr; gap:2px; } table { display:block; overflow-x:auto; } }
    @media print { .report-header { background:#fff; color:#000; padding-top:0; } .report-header p { color:#333; } body { background:#fff; } .overview,.stage-report { break-inside:avoid; border-color:#999; } details > * { display:block; } }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
  </style>
</head>
<body>
  <header class="report-header">
    <small>Stagebench evaluation · rubric ${escapeHtml(aggregate?.rubricVersion ?? evaluations[0]?.rubricVersion ?? 'unknown')}${evaluatorModel ? ` · evaluator ${escapeHtml(evaluatorModel)}` : ''}</small>
    <h1>${escapeHtml(runTitle)}</h1>
    <p>Evidence-backed evaluation of panel fidelity, sound, playability, and feature completion, rated blind against the Nord Stage 4 references. Scores use phase-specific weights and automated technical gates.</p>
    ${aggregate ? `<div class="aggregate"><strong>${floorScore(aggregate.score)}</strong><span>/100</span></div>` : '<p>Evaluation pending.</p>'}
  </header>
  <main>
    <section class="overview">
      <h2>Run overview</h2>
      <p>Run <code>${escapeHtml(run.id)}</code> · ${escapeHtml(run.status)} · ${aggregate?.evaluatedStages?.length ?? 0}/${run.stages.length} selected phases evaluated · generated ${escapeHtml(formatDate(generatedAt))} UTC</p>
      <table><thead><tr><th>Phase</th><th>Scope</th><th>Score</th></tr></thead><tbody>${run.stages.map((stage) => stageSummaryRow(stage, evaluations.find((evaluation) => evaluation.stage === stage.number))).join('')}</tbody></table>
    </section>
    ${runAxisSection(evaluations.map((evaluation) => evaluation.runAxis).filter(Boolean).at(-1))}
    ${implementationSection(implementationDetails)}
    ${evaluations.sort((left, right) => left.stage - right.stage).map(stageSection).join('')}
  </main>
  <footer>Academic UI/audio reconstruction benchmark · Not affiliated with Nord Keyboards.</footer>
</body>
</html>`
}

export function renderRunReportMarkdown(run, evaluations, implementationDetails) {
  const aggregate = run.evaluation
  const runTitle = run.title ?? run.model
  const lines = [
    `# ${runTitle} — Stagebench evaluation`,
    '',
    `- Run: \`${run.id}\``,
    `- Status: ${run.status}`,
    `- Aggregate: ${aggregate ? `**${floorScore(aggregate.score)}/100**` : 'Pending'}`,
    `- Coverage: ${aggregate?.evaluatedStages?.length ?? 0}/${run.stages.length} phases`,
    '',
    '## Phase scores',
    '',
    '| Phase | Scope | Score |',
    '| --- | --- | ---: |',
    ...run.stages.map((stage) => {
      const evaluation = evaluations.find((item) => item.stage === stage.number)
      return evaluation ? `| ${stage.number} | ${evaluation.stageName} | ${floorScore(evaluation.score)} |` : `| ${stage.number} | ${stage.status} | — |`
    }),
  ]
  if (implementationDetails?.phases?.length) {
    lines.push('', '## Audio provenance', '', 'Audio files are detected from the sealed artifact; generation methods and sample provenance are declared by the candidate.')
    for (const phase of implementationDetails.phases) {
      const generated = phase.audio.generatedSources?.map((source) => {
        const { label, detail } = describeGeneratedSource(source)
        return `${label}${detail ? ` — ${detail}` : ''}`
      }).join('; ') || 'None declared'
      const samples = phase.audio.sampleSources?.map((source) => `${source.name} — ${source.source} (${source.license})`).join('; ') || 'No recorded or external sample sources declared'
      const detected = phase.audio.detectedFiles ?? []
      const files = detected.length ? `${detected.length} file${detected.length === 1 ? '' : 's'} (${formatBytes(detected.reduce((total, file) => total + file.bytes, 0))})` : 'None detected'
      lines.push('', `### Phase ${phase.phase}: ${phase.phaseName}`, '', `- Audio strategy: ${phase.audio.strategy}`, `- Generated sound sources: ${generated}`, `- Recorded sample provenance: ${samples}`, `- Bundled audio: ${files}`)
      if (phase.audio.notes?.length) lines.push(...phase.audio.notes.map((note) => `- Audio note: ${note}`))
    }
  }
  for (const evaluation of evaluations.sort((left, right) => left.stage - right.stage)) {
    lines.push('', `## Phase ${evaluation.stage}: ${evaluation.stageName}`, '', `**${floorScore(evaluation.score)}/100**`, '', evaluation.summary, '', '### Axis scores', '', '| Axis | Weight | Score |', '| --- | ---: | ---: |')
    lines.push(...evaluation.categories.map((category) => `| ${category.label} | ${category.weight}% | ${floorScore(category.score)} |`))
    lines.push('', '### Priority issues', '')
    lines.push(...(evaluation.issues.length ? evaluation.issues.map((issue) => {
      const { severity, body } = formatIssue(issue)
      return `- ${severity ? `**${severity}** — ` : ''}${body}`
    }) : ['- None recorded.']))
    lines.push('', '### Technical gate', '', evaluation.technicalGate.passed ? 'Passed.' : `Failed; score capped at ${evaluation.technicalGate.scoreCap}.`)
  }
  return `${lines.join('\n')}\n`
}
