#!/usr/bin/env node
/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHY THIS FILE EXISTS
 *
 * `dist-full/index.css` — the stylesheet the Planner imports as
 * `@svar-ui/react-gantt/all.css` — inlines `@svar-ui/react-core`'s own CSS, and
 * that CSS declares its web fonts against a third-party host:
 *
 *   @font-face{font-family:Open Sans;...;src:local(""),
 *     url(https://cdn.svar.dev/fonts/open-sans/regular.woff2) format("woff2"),
 *     url(https://cdn.svar.dev/fonts/open-sans/regular.woff)  format("woff")}
 *
 * Six such rules ship in the built stylesheet (Open Sans 400/500/600/700,
 * Roboto 400/500). They make the renderer's text presentation depend on
 * `cdn.svar.dev` being reachable at run time, which in a firewalled or offline
 * deployment it is not: measured in a real Chromium, every one of those
 * requests fails with ERR_TUNNEL_CONNECTION_FAILED, every face reports
 * `status: "error"`, and the theme silently falls back to the browser default.
 *
 * This step replaces those six rules — and only those six — with rules that
 * name font files shipped inside this package. Families, styles and weights are
 * unchanged. Nothing else in the stylesheet is touched.
 *
 * WHAT IT WILL NOT DO
 *
 * It is fail-closed on both sides. If the built stylesheet does not contain
 * exactly the six rules `planner-assets/fonts/fonts.json` says it replaces, the
 * build stops rather than guessing: an upstream intake that changes the font
 * declarations must be looked at by a person, not absorbed silently. And if any
 * `cdn.svar.dev` reference survives the rewrite, the build stops too.
 *
 * PROVENANCE OF THE BINARIES (project rule: licences are a hard gate)
 *
 * The font files are committed to this repository under `planner-assets/fonts/`
 * together with their licences and the exact URL and sha256 each came from
 * (`fonts.json`). Both families are SIL Open Font License 1.1 with no Reserved
 * Font Name, taken from Google Fonts, which is their authoritative distributor.
 * This step re-checks every sha256 before copying, so a corrupted or swapped
 * binary fails the build instead of shipping.
 *
 * SVAR-LOCAL-ASSETS: the licence TEXTS ship too, not just the binaries they
 * cover. `package.json`'s `files` has named a `licenses/` directory since the
 * fonts were added, but nothing wrote one — `npm pack` silently drops a `files`
 * entry that does not exist rather than failing, so the installed consumer
 * package carried the OFL binaries with no OFL text next to them. This step
 * copies the exact committed licence files there (re-checking their sha256 the
 * same way it already does for the binaries), so that defect cannot recur
 * silently: a missing or renamed licence file now fails the build instead of
 * failing to pack.
 *
 * WHAT IT DOES NOT COVER (deliberately)
 *
 * `@svar-ui/react-core`'s theme components also inject, at run time,
 * `<link rel="stylesheet" href="https://cdn.svar.dev/fonts/wxi/wx-icons.css">`
 * — the wxi ICON font. That asset is published nowhere but that CDN and carries
 * no redistribution licence this project could establish, so it is deliberately
 * left alone here. See PLANNER_FORK.md.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsDir = join(packageRoot, 'planner-assets', 'fonts');
const distFullDir = join(packageRoot, 'dist-full');
const stylesheet = join(distFullDir, 'index.css');

const fail = (message) => {
	console.error(`planner-fonts: ${message}`);
	process.exit(1);
};

const spec = JSON.parse(readFileSync(join(assetsDir, 'fonts.json'), 'utf8'));

/* 1. The committed binaries are the ones fonts.json recorded. --------------- */

for (const file of spec.files) {
	const bytes = readFileSync(join(assetsDir, file.name));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (sha256 !== file.sha256) {
		fail(
			`planner-assets/fonts/${file.name} sha256 is ${sha256}, fonts.json records ${file.sha256}`
		);
	}
	if (bytes.length !== file.bytes) {
		fail(
			`planner-assets/fonts/${file.name} is ${bytes.length} bytes, fonts.json records ${file.bytes}`
		);
	}
}

/* 1.5. The committed licence texts are the ones fonts.json recorded, and they
 *      ship in a real `licenses/` directory — the one `package.json`'s `files`
 *      already names. --------------------------------------------------- */

const licensesOut = join(packageRoot, 'licenses');
mkdirSync(licensesOut, { recursive: true });
for (const licence of spec.licences) {
	const bytes = readFileSync(join(assetsDir, licence.file));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (sha256 !== licence.sha256) {
		fail(
			`planner-assets/fonts/${licence.file} sha256 is ${sha256}, fonts.json records ${licence.sha256}`
		);
	}
	copyFileSync(join(assetsDir, licence.file), join(licensesOut, licence.file));
}

/* 2. The built stylesheet declares exactly the rules we expect to replace. --- */

const css = readFileSync(stylesheet, 'utf8');
const faceRule = /@font-face\{[^}]*\}/g;
const remoteRules = (css.match(faceRule) ?? []).filter((rule) =>
	rule.includes('cdn.svar.dev')
);

const describe = (rule) => {
	const family = /font-family:([^;}]+)/.exec(rule)?.[1]?.trim();
	const weight = Number(/font-weight:(\d+)/.exec(rule)?.[1]);
	const urls = [...rule.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
	return { family, weight, urls };
};

const seen = remoteRules.map(describe);
const expected = spec.replaces;

if (seen.length !== expected.length) {
	fail(
		`expected ${expected.length} @font-face rules naming cdn.svar.dev, found ${seen.length}. ` +
			`The upstream font declarations changed; update planner-assets/fonts/fonts.json deliberately.`
	);
}

for (const want of expected) {
	const match = seen.find(
		(rule) =>
			rule.family.replace(/["']/g, '') === want.family &&
			rule.weight === want.weight &&
			rule.urls.length === 2 &&
			rule.urls[0] === want.woff2 &&
			rule.urls[1] === want.woff
	);
	if (!match) {
		fail(
			`the built stylesheet no longer declares ${want.family} ${want.weight} as ` +
				`${want.woff2} + ${want.woff}. Refusing to rewrite a stylesheet this step does not recognise.`
		);
	}
}

/* 3. Rewrite each recognised rule into its local equivalents. ---------------- */

const localRulesFor = (family, weight, familyAsWritten) =>
	spec.rules
		.filter((rule) => rule.family === family && rule.weight === weight)
		.map(
			(rule) =>
				`@font-face{font-family:${familyAsWritten};font-style:${rule.style};` +
				`font-weight:${rule.weight};src:local(""),` +
				`url(./fonts/${rule.woff2}) format("woff2"),` +
				`url(./fonts/${rule.woff}) format("woff");` +
				`unicode-range:${rule.unicodeRange}}`
		)
		.join('');

let rewritten = css;
for (const rule of remoteRules) {
	const { family, weight } = describe(rule);
	const bare = family.replace(/["']/g, '');
	const replacement = localRulesFor(bare, weight, family);
	if (!replacement) fail(`no local rules generated for ${bare} ${weight}`);
	rewritten = rewritten.replace(rule, replacement);
}

if (rewritten.includes('cdn.svar.dev')) {
	fail('a cdn.svar.dev reference survived the rewrite');
}
if (rewritten === css) fail('the stylesheet was not rewritten at all');

/* 4. Ship the binaries next to the stylesheet that names them. --------------- */

const fontsOut = join(distFullDir, 'fonts');
mkdirSync(fontsOut, { recursive: true });
for (const file of spec.files) {
	copyFileSync(join(assetsDir, file.name), join(fontsOut, file.name));
}

writeFileSync(stylesheet, rewritten);

console.log(
	`planner-fonts: ${remoteRules.length} remote @font-face rules -> ` +
		`${spec.rules.length} local rules over ${spec.files.length} files ` +
		`(${spec.subsets.join(', ')})`
);
console.log(
	`planner-fonts: ${spec.licences.length} licence file(s) verified and shipped to licenses/ ` +
		`(${spec.licences.map((l) => l.file).join(', ')})`
);
