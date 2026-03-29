

import React, { useState, useCallback } from 'react';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/80 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Copy"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      )}
    </button>
  );
}

const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function isSafeUrl(href: string): string {
  const trimmed = href.trim();
  // Allow relative URLs and fragments
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('#')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (SAFE_URL_PROTOCOLS.includes(parsed.protocol)) {
      return trimmed;
    }
  } catch {
    // Not a valid absolute URL — treat as relative (safe)
    return trimmed;
  }
  // Blocked protocol (javascript:, data:, vbscript:, etc.)
  return '#';
}

function resolveLocalSrc(src: string): string {
  if (src.startsWith('/') || /^[A-Z]:\\/.test(src)) {
    return `http://127.0.0.1:31415/api/local-file?path=${encodeURIComponent(src)}`;
  }
  return src;
}

// Render inline markdown (bold, italic, code, images, links)
function renderInline(text: string, onLinkClick?: (href: string) => void): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<code key={key++} className="px-1 py-0.5 text-xs bg-secondary rounded font-mono">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Image ![alt](src) — check before links
    if (remaining.startsWith('![')) {
      const closeBracket = remaining.indexOf(']', 2);
      if (closeBracket !== -1 && remaining[closeBracket + 1] === '(') {
        const closeParen = remaining.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const alt = remaining.slice(2, closeBracket);
          const src = resolveLocalSrc(remaining.slice(closeBracket + 2, closeParen));
          parts.push(
            <img key={key++} src={src} alt={alt} className="max-w-full rounded my-2 inline-block" />
          );
          remaining = remaining.slice(closeParen + 1);
          continue;
        }
      }
    }

    // Link [text](url)
    if (remaining.startsWith('[')) {
      const closeBracket = remaining.indexOf(']', 1);
      if (closeBracket !== -1 && remaining[closeBracket + 1] === '(') {
        const closeParen = remaining.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = remaining.slice(1, closeBracket);
          const rawHref = remaining.slice(closeBracket + 2, closeParen);
          const isExternal = /^https?:\/\/|^mailto:/i.test(rawHref);

          if (!isExternal && onLinkClick) {
            // Internal link — navigate within the vault
            const capturedHref = rawHref;
            parts.push(
              <a
                key={key++}
                href="#"
                className="text-primary underline hover:text-primary/80 cursor-pointer"
                onClick={(e) => { e.preventDefault(); onLinkClick(capturedHref); }}
              >
                {linkText}
              </a>
            );
          } else {
            const href = isSafeUrl(rawHref);
            parts.push(
              <a key={key++} href={href} className="text-primary underline hover:text-primary/80" target="_blank" rel="noopener noreferrer">
                {linkText}
              </a>
            );
          }
          remaining = remaining.slice(closeParen + 1);
          continue;
        }
      }
    }

    // Regular text — advance to next special character
    const nextSpecial = remaining.search(/[`*\[!]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Special char didn't match any pattern above — emit as text
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return <>{parts}</>;
}

export function SimpleMarkdown({ content, highlightLine, onLinkClick }: { content: string; highlightLine?: number; onLinkClick?: (href: string) => void }) {
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const codeText = codeBlockContent.join('\n');
        elements.push(
          <div key={i} className="relative group my-2">
            <CopyButton text={codeText} />
            <pre className="bg-secondary/80 border border-border rounded-md p-3 overflow-x-auto text-xs">
              <code>{codeText}</code>
            </pre>
          </div>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty lines
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-3" />);
      continue;
    }

    // Headers
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-2xl font-bold text-foreground mt-4 mb-2">{renderInline(line.slice(2), onLinkClick)}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-xl font-bold text-foreground mt-3 mb-2">{renderInline(line.slice(3), onLinkClick)}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-lg font-semibold text-foreground mt-3 mb-1">{renderInline(line.slice(4), onLinkClick)}</h3>);
      continue;
    }

    // Horizontal rule
    if (line.match(/^-{3,}$/) || line.match(/^\*{3,}$/)) {
      elements.push(<hr key={i} className="border-border my-4" />);
      continue;
    }

    // Bullet list
    if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      const text = line.replace(/^\s*[-*]\s/, '');
      elements.push(
        <div key={i} className="flex gap-2 my-0.5" style={{ paddingLeft: `${indent * 8 + 8}px` }}>
          <span className="text-muted-foreground mt-1.5 shrink-0">&#8226;</span>
          <span className="text-sm text-foreground">{renderInline(text, onLinkClick)}</span>
        </div>
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\s*\d+\.\s/)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)$/);
      if (match) {
        const indent = match[1].length;
        elements.push(
          <div key={i} className="flex gap-2 my-0.5" style={{ paddingLeft: `${indent * 8 + 8}px` }}>
            <span className="text-muted-foreground shrink-0">{match[2]}.</span>
            <span className="text-sm text-foreground">{renderInline(match[3], onLinkClick)}</span>
          </div>
        );
        continue;
      }
    }

    // Image on its own line (use trim to handle trailing whitespace/\r)
    const trimmed = line.trim();
    if (trimmed.startsWith('![')) {
      const closeBracket = trimmed.indexOf(']', 2);
      if (closeBracket !== -1 && trimmed[closeBracket + 1] === '(') {
        const closeParen = trimmed.indexOf(')', closeBracket + 2);
        if (closeParen !== -1 && closeParen === trimmed.length - 1) {
          const alt = trimmed.slice(2, closeBracket);
          const src = resolveLocalSrc(trimmed.slice(closeBracket + 2, closeParen));
          elements.push(
            <div key={i} className="my-2">
              <img src={src} alt={alt} className="max-w-full rounded" />
            </div>
          );
          continue;
        }
      }
    }

    // Table (lines starting with |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Collect all consecutive table lines
      const tableLines: string[] = [trimmed];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (next.startsWith('|') && next.endsWith('|')) {
          tableLines.push(next);
          j++;
        } else {
          break;
        }
      }

      // Need at least 2 lines (header + separator) to be a table
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.slice(1, -1).split('|').map(cell => cell.trim());

        const headerCells = parseRow(tableLines[0]);

        // Check if second line is a separator (contains only -, :, |, spaces)
        const isSeparator = /^[|\s:+-]+$/.test(tableLines[1]) && tableLines[1].includes('-');
        const separatorCells = isSeparator ? parseRow(tableLines[1]) : [];

        // Determine alignment from separator
        const alignments = separatorCells.map(cell => {
          const left = cell.startsWith(':');
          const right = cell.endsWith(':');
          if (left && right) return 'center' as const;
          if (right) return 'right' as const;
          return 'left' as const;
        });

        const dataStartIdx = isSeparator ? 2 : 1;
        const dataRows = tableLines.slice(dataStartIdx).map(parseRow);

        elements.push(
          <div key={i} className="my-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {headerCells.map((cell, ci) => (
                    <th
                      key={ci}
                      className="px-3 py-1.5 text-left font-semibold text-foreground"
                      style={alignments[ci] ? { textAlign: alignments[ci] } : undefined}
                    >
                      {renderInline(cell, onLinkClick)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-1.5 text-foreground"
                        style={alignments[ci] ? { textAlign: alignments[ci] } : undefined}
                      >
                        {renderInline(cell, onLinkClick)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

        i = j - 1; // skip consumed lines (loop will i++)
        continue;
      }
    }

    // Blockquote — group consecutive > lines
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [line.slice(2)];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('> ')) {
        quoteLines.push(lines[j].slice(2));
        j++;
      }
      const quoteText = quoteLines.join('\n');
      elements.push(
        <div key={i} className="relative group my-1">
          <CopyButton text={quoteText} />
          <blockquote className="border-l-2 border-primary/50 pl-3 pr-8 text-sm text-muted-foreground italic">
            {quoteLines.map((ql, qi) => (
              <p key={qi} className="my-0.5">{renderInline(ql, onLinkClick)}</p>
            ))}
          </blockquote>
        </div>
      );
      i = j - 1;
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} className="text-sm text-foreground my-0.5">{renderInline(line, onLinkClick)}</p>);
  }

  // Close any open code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    const codeText = codeBlockContent.join('\n');
    elements.push(
      <div key="final-code" className="relative group my-2">
        <CopyButton text={codeText} />
        <pre className="bg-secondary/80 border border-border rounded-md p-3 overflow-x-auto text-xs">
          <code>{codeText}</code>
        </pre>
      </div>
    );
  }

  return (
    <div>
      {elements.map((el) => {
        const k = el.key;
        const lineNum = typeof k === 'string' && /^\d+$/.test(k) ? parseInt(k) + 1 : null;
        if (!lineNum) return el;
        return (
          <div
            key={k}
            id={`doc-line-${lineNum}`}
            data-source-line={lineNum}
            className={highlightLine === lineNum ? 'bg-primary/15 -mx-2 px-2 rounded transition-colors' : undefined}
          >
            {el}
          </div>
        );
      })}
    </div>
  );
}
