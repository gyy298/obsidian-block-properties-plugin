import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import type BlockPropertiesPlugin from "./main";

interface BlockRefItem {
	blockId: string;
	content: string;
	file: TFile;
}

/**
 * Provides block-reference autocomplete triggered by `[[^` anywhere in the
 * editor. Supports Unicode queries (Chinese, Japanese, etc.).
 *
 * Selecting a suggestion inserts:
 *   - Same file  → [[#^blockid]]
 *   - Other file → [[filename#^blockid]]
 */
export class BlockRefSuggest extends EditorSuggest<BlockRefItem> {
	private cache: BlockRefItem[] = [];
	private cacheTime = 0;
	private readonly CACHE_TTL = 60_000;
	private buildPromise: Promise<void> | null = null;

	constructor(private plugin: BlockPropertiesPlugin) {
		super(plugin.app);
	}

	invalidateCache(): void {
		this.cacheTime = 0;
	}

	async warmCache(): Promise<void> {
		if (this.cacheTime === 0) {
			await this.buildCache();
		}
	}

	// ── Trigger ────────────────────────────────────────────────────────────────

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const before = line.slice(0, cursor.ch);

		// Match [[^ followed by any non-bracket characters (Unicode-safe)
		const match = before.match(/\[\[(\^[^\][]*?)$/);
		if (!match || !match[1]) return null;

		const triggerStart = cursor.ch - match[1].length;

		return {
			start: { line: cursor.line, ch: triggerStart },
			end: cursor,
			query: match[1].slice(1), // strip ^; Obsidian may re-compute this
		};
	}

	// ── Suggestions ────────────────────────────────────────────────────────────

	async getSuggestions(
		context: EditorSuggestContext,
	): Promise<BlockRefItem[]> {
		if (Date.now() - this.cacheTime > this.CACHE_TTL) {
			await this.buildCache();
		}

		// Obsidian computes context.query as editor.getRange(start, end),
		// which starts at `^`, so strip it before matching.
		const query = context.query.replace(/^\^/, "").toLowerCase();

		let items = this.cache;
		if (query) {
			items = items.filter(
				(b) =>
					b.blockId.toLowerCase().includes(query) ||
					b.content.toLowerCase().includes(query),
			);
		}
		return items.slice(0, 20);
	}

	// ── Cache ──────────────────────────────────────────────────────────────────

	private buildCache(): Promise<void> {
		if (!this.buildPromise) {
			this.buildPromise = this.doScan().finally(() => {
				this.buildPromise = null;
			});
		}
		return this.buildPromise;
	}

	/**
	 * Scan every markdown file for lines that contain a block ID.
	 *
	 * Accepted line shapes:
	 *   <content text>  ^blockId [optional properties]
	 *   <content text>  ^blockId
	 *
	 * We use a single regex instead of parseBlockProperties to avoid
	 * any shared global-regex state issues.
	 */
	private async doScan(): Promise<void> {
		const items: BlockRefItem[] = [];
		const seen = new Set<string>();

		// Matches: <content> SPACE ^blockId [optional [...]]
		// Group 1 = content before the block ID
		// Group 2 = block ID
		const LINE_RE = /^(.*?)\s+\^([\w-]+)(?:\s*\[[^\]]*\])?\s*$/;

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			let text: string;
			try {
				text = await this.app.vault.cachedRead(file);
			} catch {
				continue;
			}

			for (const rawLine of text.split("\n")) {
				// Normalise Windows (\r\n) and old-Mac (\r) line endings
				const line = rawLine.replace(/\r$/, "");
				if (!line.trim()) continue;

				const m = line.match(LINE_RE);
				if (!m || !m[1] || !m[2]) continue;

				const blockId = m[2];
				const content = m[1].trim();

				if (!content || seen.has(blockId)) continue;

				seen.add(blockId);
				items.push({ blockId, content, file });
			}
		}

		this.cache = items;
		this.cacheTime = Date.now();
	}

	// ── Rendering ──────────────────────────────────────────────────────────────

	renderSuggestion(item: BlockRefItem, el: HTMLElement): void {
		el.addClass("block-ref-suggest-item");

		const preview =
			item.content.length > 70
				? item.content.slice(0, 70) + "\u2026"
				: item.content;
		el.createEl("div", { text: preview, cls: "block-ref-suggest-content" });

		const meta = el.createEl("div", { cls: "block-ref-suggest-meta" });
		meta.createEl("span", {
			text: `^${item.blockId}`,
			cls: "block-ref-suggest-id",
		});
		meta.createEl("span", {
			text: item.file.basename,
			cls: "block-ref-suggest-file",
		});
	}

	// ── Selection ──────────────────────────────────────────────────────────────

	selectSuggestion(
		item: BlockRefItem,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		if (!this.context) return;

		const { editor, start, end } = this.context;
		const currentFile = this.app.workspace.getActiveFile();

		let replacement: string;
		if (currentFile && item.file.path === currentFile.path) {
			replacement = `[[#^${item.blockId}]]`;
		} else {
			const linkText = this.app.metadataCache.fileToLinktext(
				item.file,
				currentFile?.path ?? "",
			);
			replacement = `[[${linkText}#^${item.blockId}]]`;
		}

		// Replace from the `[[` that precedes the trigger start.
		// Also consume any `]]` Obsidian may have auto-inserted after the cursor.
		const lineText = editor.getLine(start.line);
		const bracketPos = lineText.lastIndexOf("[[", start.ch);

		const afterCursor = lineText.slice(end.ch);
		const actualEnd = afterCursor.startsWith("]]")
			? { line: end.line, ch: end.ch + 2 }
			: end;

		editor.replaceRange(
			replacement,
			{ line: start.line, ch: bracketPos },
			actualEnd,
		);
	}
}
