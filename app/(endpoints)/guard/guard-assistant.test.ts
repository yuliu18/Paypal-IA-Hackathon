import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantAnswer, GuardAssistant } from './guard-assistant';

describe('AssistantAnswer', () => {
  it('shows the answer as text: no HTML, no links, no markdown turned into anything', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantAnswer, { answer: '<img src=x onerror=alert(1)> [Approve](javascript:approve()) **bold**\nnext line' }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('<button');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; [Approve](javascript:approve()) **bold**\nnext line');
  });
});

describe('GuardAssistant', () => {
  it('offers suggested questions as chips that only fill the input, with no action buttons', () => {
    const html = renderToStaticMarkup(createElement(GuardAssistant));
    expect(html).toContain('Why was the last refund blocked?');
    expect(html).toContain('What is waiting for me?');
    expect(html).toContain('maxLength="500"');
    expect(html).not.toMatch(/Approve|Reject/);
  });
});
