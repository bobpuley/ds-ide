/// <reference lib="dom" />
// SD Card content viewer (FR-SD-1), extracted from controls-webview.ts
// (FR-EXT-32) — owns its own enabled/entries/expanded-preview state instead
// of sharing controls-webview.ts's module scope with five other concerns.
import type { ControlsWebviewMessage } from '../messages';
import { SdEntry, isTxtEntryName, formatSdSize } from '../sd-viewer';
import { escJ } from './text-utils';

export interface SdCardPanel {
  applyEnabled(enabled: boolean): void;
  applyContents(entries: SdEntry[]): void;
  applyPreview(name: string, content: string | null): void;
}

export function createSdCardPanel(vscode: { postMessage(msg: ControlsWebviewMessage): void }): SdCardPanel {
  let sdEnabled = false;
  let sdEntries: SdEntry[] = [];
  let sdExpandedName: string | null = null;
  const sdPreviews: Record<string, string | null> = {};

  function renderSdSection(): void {
    const countEl = document.getElementById('sd-count');
    if (countEl) countEl.textContent = sdEntries.length ? `${sdEntries.length} file${sdEntries.length === 1 ? '' : 's'}` : '';

    const list = document.getElementById('sd-list');
    if (!list) return;
    if (!sdEntries.length) {
      list.innerHTML = '<div class="sd-empty-state">SD card is empty</div>';
      return;
    }
    list.innerHTML = sdEntries.map(e => {
      const isTxt = isTxtEntryName(e.name);
      const expanded = sdExpandedName === e.name;
      let previewHtml = '';
      if (expanded) {
        if (!isTxt) {
          previewHtml = '<div class="sd-preview unavailable">preview not available</div>';
        } else if (!(e.name in sdPreviews)) {
          previewHtml = '<div class="sd-preview unavailable">loading…</div>';
        } else if (sdPreviews[e.name] === null) {
          previewHtml = '<div class="sd-preview unavailable">preview not available</div>';
        } else {
          previewHtml = '<div class="sd-preview">' + escJ(sdPreviews[e.name] || '') + '</div>';
        }
      }
      return (
        '<div class="sd-row" data-name="' + escJ(e.name) + '">' +
          '<span class="name" title="' + escJ(e.name) + '">' + escJ(e.name) + '</span>' +
          '<span class="size">' + formatSdSize(e.size) + '</span>' +
        '</div>' + previewHtml
      );
    }).join('');
    list.querySelectorAll('.sd-row').forEach(row => {
      row.addEventListener('click', () => {
        const name = (row as HTMLElement).dataset['name'] || '';
        if (sdExpandedName === name) {
          sdExpandedName = null;
        } else {
          sdExpandedName = name;
          if (isTxtEntryName(name) && !(name in sdPreviews)) {
            vscode.postMessage({ command: 'sdPreview', name });
          }
        }
        renderSdSection();
      });
    });
  }

  document.getElementById('sd-refresh-btn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'sdRefresh' });
  });

  return {
    applyEnabled(enabled: boolean): void {
      sdEnabled = enabled;
      const section = document.getElementById('sdcard-contents');
      if (section) section.style.display = enabled ? 'flex' : 'none';
      if (!enabled) {
        sdExpandedName = null;
      }
    },
    applyContents(entries: SdEntry[]): void {
      sdEntries = entries;
      // Stale preview state for a file that's no longer listed (or whose
      // content may have changed) is dropped on every fresh listing.
      for (const name of Object.keys(sdPreviews)) {
        if (!entries.some(e => e.name === name)) delete sdPreviews[name];
      }
      if (sdExpandedName && !entries.some(e => e.name === sdExpandedName)) sdExpandedName = null;
      renderSdSection();
    },
    applyPreview(name: string, content: string | null): void {
      sdPreviews[name] = content;
      if (sdExpandedName === name) renderSdSection();
    },
  };
}
