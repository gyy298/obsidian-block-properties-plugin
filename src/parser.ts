import { BlockProperties, BlockProperty } from "./types";
import { parseLinksInValue } from "./link-parser";

// Matches: [key: value, key2: value2] ^block-id
// Group 1: properties string
// Group 2: block-id
const BLOCK_PROPS_REGEX = /\[([^\]]+)\]\s*\^([\w-]+)/g;

export function parseBlockProperties(
	text: string,
	offset = 0,
): BlockProperties[] {
	const results: BlockProperties[] = [];
	let match: RegExpExecArray | null;

	// Reset regex state
	BLOCK_PROPS_REGEX.lastIndex = 0;

	while ((match = BLOCK_PROPS_REGEX.exec(text)) !== null) {
		const blockId = match[2];
		const propsString = match[1];

		if (!blockId || !propsString) continue;

		const properties = parsePropertiesString(propsString);

		results.push({
			blockId,
			properties,
			from: offset + match.index,
			to: offset + match.index + match[0].length,
		});
	}

	return results;
}

function parsePropertiesString(propsString: string): BlockProperty[] {
	const properties: BlockProperty[] = [];
	const pairs = propsString.split(",");

	for (const pair of pairs) {
		const colonIndex = pair.indexOf(":");
		if (colonIndex === -1) continue;

		const key = pair.slice(0, colonIndex).trim();
		const value = pair.slice(colonIndex + 1).trim();

		if (key) {
			const parsedValue = parseLinksInValue(value);
			properties.push({ key, value, parsedValue });
		}
	}

	return properties;
}

// Find the range of just the properties part [...]
export function getPropertiesRange(
	text: string,
	offset = 0,
): { from: number; to: number } | null {
	BLOCK_PROPS_REGEX.lastIndex = 0;
	const match = BLOCK_PROPS_REGEX.exec(text);

	if (!match) return null;

	// match[0] is "[props] ^id" — return only the bracket range
	const bracketEnd = match[0].indexOf("]") + 1;
	const from = offset + match.index;
	const to = offset + match.index + bracketEnd;

	return { from, to };
}
