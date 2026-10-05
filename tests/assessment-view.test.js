import { describe, it, expect } from 'vitest';
import {
  renderCalibration,
  renderCaseConsistency,
  renderMarkdownLite,
  renderOverallConsistency,
} from '../public/assessment-view.js';

describe('renderMarkdownLite', () => {
  it('renders headings, bold, code, lists, and fenced blocks', () => {
    const html = renderMarkdownLite([
      '## Rules',
      'Use **our** names like `MILK`.',
      '',
      '1. Shared fryer',
      '   - not pan-fried',
      '- Coconut is fine',
      '```',
      'Allergens: <list>',
      '```',
    ].join('\n'));
    expect(html).toContain('<h4 class="eval-material__heading">Rules</h4>');
    expect(html).toContain('<p>Use <strong>our</strong> names like <code>MILK</code>.</p>');
    expect(html).toContain('<ol><li>Shared fryer</li></ol><ul><li class="eval-material__sub">not pan-fried</li>');
    expect(html).toContain('<pre class="eval-material__code">Allergens: &lt;list&gt;</pre>');
  });

  it('escapes HTML before formatting', () => {
    const html = renderMarkdownLite('**<img src=x onerror=alert(1)>** <script>x</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
  });
});

describe('assessment result markup', () => {
  it('summarizes stability and per-case agreement', () => {
    expect(renderOverallConsistency({ stability: 0.8, consistentCases: 1, comparedCases: 2 }))
      .toContain('Stability <strong>80%</strong>');
    expect(renderOverallConsistency({ stability: null, consistentCases: 0, comparedCases: 0 }))
      .toContain('run each case at least twice');
    expect(renderCaseConsistency({ agreeing: 3, runs: 5, distinct: 2, basis: [] }))
      .toContain('3/5 runs agree · 2 different answers');
    expect(renderCaseConsistency({ agreeing: 1, runs: 1, distinct: 1, basis: [] })).toBe('');
  });

  it('marks stale calibrations when the criteria changed', () => {
    const samples = [{ id: 's1', label: 'Sample 1', input: 'a', output: 'b', verdict: 'pass', note: '' }];
    const calibration = {
      criteria: 'old',
      samples: [{ id: 's1', verdict: 'fail', reason: 'Too long', agree: false }],
      agreement: { agreeing: 0, total: 1 },
    };
    const html = renderCalibration(samples, calibration, 'new');
    expect(html).toContain('agrees with the reviewer on 0 of 1 samples');
    expect(html).toContain('You changed the criteria since this test');
    expect(html).toContain('Disagrees');
    expect(renderCalibration(samples, calibration, 'old')).not.toContain('You changed the criteria');
  });
});
