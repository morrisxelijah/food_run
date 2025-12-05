// a helper for parsing recipes from html pages

import type { Ingredient } from "../types";


// shape returned to the client for previewing parsed recipes
export interface ParsedRecipe {
    title: string;
    servings: number | null;
    ingredients: Ingredient[];
}




// helper  -->  unescape a few common html entities so text reads cleanly
function decodeHtmlEntities(raw: string): string {
    return raw
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}




// helper  -->  try to pull a reasonable title from og:title or <title>
function extractTitleFromHtml(html: string): string {
    // try og:title meta first
    const ogTitleMatch = html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    );
    if (ogTitleMatch && ogTitleMatch[1])  return decodeHtmlEntities(ogTitleMatch[1]);

    // fallback to <title>
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1]) return decodeHtmlEntities(titleMatch[1]);

    return "";
}




// helper  -->  try to grab servings from json-ld-like strings
function extractServings(value: unknown): number | null {
    if (typeof value === "number") return value;

    if (typeof value === "string") {
        // common patterns: "Serves 4", "4 servings", "6 serving(s)"
        const match = value.match(/(\d+)/);
        if (match) return Number.parseInt(match[1], 10);
    }

    return null;
}




// helper  -->  best effort servings fallback from raw html text
function extractServingsFromHtml(html: string): number | null {
    const lower = html.toLowerCase();

    // try "serves 4" or "serves: 4"
    let match = lower.match(/serves[^0-9]{0,20}(\d+)/i);
    if (!match)  match = lower.match(/(\d+)[^0-9]{0,10}servings?/i);

    if (!match) return null;

    const maybe = Number.parseInt(match[1], 10);
    return Number.isNaN(maybe) ? null : maybe;
}




// helper  -->  basic parser for "amount unit name" ingredient lines
function parseIngredientLine(raw: string): Ingredient {
    // decode entities and normalize whitespace
    const text = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();

    // default ingredient shape  -->  name only
    let amount: number | null = null;
    let unit: string | null = null;
    let name = text;

    if (!text) {
        return {
            name,
            amount,
            unit,
            notes: null,
        };
    }

    const parts = text.split(" ");
    if (parts.length === 0) {
        return {
            name,
            amount,
            unit,
            notes: null,
        };
    }

    // try to parse the first token as a number
    // strip non-numeric / non-dot / non-slash characters so "2.5," still works
    const numericToken = parts[0].replace(/[^\d./]/g, "");
    const maybeAmount = Number(numericToken);

    if (!Number.isNaN(maybeAmount) && /\d/.test(numericToken)) {
        amount = maybeAmount;

        // at least 3 segments ?  -->  treat the second as unit and the rest as name
        if (parts.length >= 3) {
            unit = parts[1];
            name = parts.slice(2).join(" ");
        } else {
            // "2 onions" style  -->  no explicit unit
            unit = null;
            name = parts.slice(1).join(" ");
        }
    }

    return {
        name,
        amount,
        unit,
        // notes is optional on the type  -->  keep null for now
        notes: null,
    };
}




// helper  -->  recursively search a parsed json object for recipe nodes
function findRecipeNodes(node: unknown, results: unknown[] = []): unknown[] {
    if (!node || typeof node !== "object") return results;

    if (Array.isArray(node)) {
        for (const item of node) findRecipeNodes(item, results);
        return results;
    }

    const record = node as Record<string, unknown>;

    // @type can be "Recipe" or ["Thing", "Recipe"]
    const typeValue = record["@type"];
    if (typeof typeValue === "string") {
        if (typeValue.toLowerCase() === "recipe")  results.push(record);
    } else if (Array.isArray(typeValue)) {
        if (
            typeValue.some(
                (entry) =>
                    typeof entry === "string" &&
                    entry.toLowerCase() === "recipe",
            )
        ) {
            results.push(record);
        }
    }

    // keep walking nested objects (e.g. @graph, mainEntityOfPage, etc.)
    for (const value of Object.values(record)) findRecipeNodes(value, results);

    return results;
}




// attempt #1  -->  parse json-ld <script type="application/ld+json"> blocks and pull recipeIngredient if possible
function parseFromJsonLd(html: string): ParsedRecipe | null {
    const scriptRegex =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    const allRecipeNodes: Record<string, unknown>[] = [];

    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
        const rawJson = match[1].trim();
        if (!rawJson) continue;

        // some sites jam multiple json objects together without commas  -->  try best effort fixes
        const candidates: unknown[] = [];

        try {
            const parsed = JSON.parse(rawJson);
            candidates.push(parsed);
        } catch {
            // fallback  -->  wrap in [ ... ] and insert commas between }{
            try {
                const fixed = `[${rawJson.replace(/}\s*{/g, "},{")}]`;
                const parsed = JSON.parse(fixed);
                candidates.push(parsed);
            } catch {
                // give up on this attempt
            }
        }

        for (const root of candidates) {
            const recipeNodes = findRecipeNodes(root);
            for (const node of recipeNodes) {
                allRecipeNodes.push(node as Record<string, unknown>);
            }
        }
    }

    if (allRecipeNodes.length === 0) return null;

    const primary = allRecipeNodes[0];

    const titleValue =
        (primary.name as string | undefined) ??
        (primary.headline as string | undefined) ??
        (primary.alternateName as string | undefined) ??
        "";
    const title = decodeHtmlEntities(titleValue);

    const yieldValue =
        primary.recipeYield ??
        primary.recipeServings ??
        primary.yield ??
        null;
    const servings = extractServings(yieldValue);

    const rawIngredients =
        (primary.recipeIngredient as unknown) ??
        (primary.ingredients as unknown) ??
        [];

    const ingredientStrings: string[] = [];

    if (Array.isArray(rawIngredients)) {
        for (const item of rawIngredients) {
            if (typeof item === "string") {
                ingredientStrings.push(item);
            } else if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                const text =
                    (typeof record.text === "string"
                        ? record.text
                        : typeof record.name === "string"
                            ? record.name
                            : "") ?? "";
                if (text) {
                    ingredientStrings.push(text);
                }
            }
        }
    }

    const ingredients: Ingredient[] = ingredientStrings.map((line) =>
        parseIngredientLine(line),
    );

    return {
        title,
        servings,
        ingredients,
    };
}




// attempt #2  -->  parse the html between the last "ingredients" heading and the next "directions / instructions / steps" heading and collect <li> items
function parseFromIngredientsSection(html: string): string[] {
    // step 1  -->  find all heading tags and remember the *last* one that mentions "ingredients"
    const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

    let ingredientsHeadingEndIndex = -1;

    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = headingRegex.exec(html)) !== null) {
        const innerRaw = headingMatch[2] ?? "";
        // strip nested tags, decode entities, compress whitespace
        const innerText = decodeHtmlEntities(
            innerRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
        ).toLowerCase();

        if (innerText.includes("ingredient")) {
            // keep the end index of the *last* ingredients heading
            ingredientsHeadingEndIndex = headingMatch.index + headingMatch[0].length;
        }
    }

    if (ingredientsHeadingEndIndex === -1)  return [];  // no ingredients heading found at all

    const afterHeading = html.slice(ingredientsHeadingEndIndex);

    // step 2  -->  within the slice, stop at the first heading that looks like directions / instructions / method / steps
    const stopHeadingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

    let stopIndexRelative = -1;
    let stopMatch: RegExpExecArray | null;
    while ((stopMatch = stopHeadingRegex.exec(afterHeading)) !== null) {
        const innerRaw = stopMatch[2] ?? "";
        const innerText = decodeHtmlEntities(
            innerRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
        ).toLowerCase();

        if (
            innerText.includes("direction") ||
            innerText.includes("instruction") ||
            innerText.includes("method") ||
            innerText.includes("step")
        ) {
            stopIndexRelative = stopMatch.index;
            break;
        }
    }

    const sectionHtml =
        stopIndexRelative === -1
            ? afterHeading
            : afterHeading.slice(0, stopIndexRelative);

    // step 3  -->  collect all <li> items in this slice
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    const ingredients: string[] = [];

    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRegex.exec(sectionHtml)) !== null) {
        const raw = liMatch[1];

        // strip nested tags and compress whitespace
        const text = decodeHtmlEntities(
            raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
        );

        if (!text) continue;

        ingredients.push(text);
    }

    // filter obvious non-ingredient lines (mostly nutrition blurbs)
    const filtered = ingredients.filter((line) => {
        const lower = line.toLowerCase();

        if (lower.includes("nutrition information")) return false;
        if (lower.startsWith("per serving")) return false;
        if (lower.startsWith("note:")) return false;
        if (lower.includes("calories")) return false;
        if (lower.includes("fat ") && lower.includes("protein")) return false;

        return true;
    });

    return filtered;
}




// helper  -->  map plain strings into Ingredient shape
function normalizeIngredients(lines: string[]): Ingredient[] {
    return lines.map((line) => parseIngredientLine(line));
}




// helper  -->  fix newsletter-style titles for joshuaweissman.com
function tweakNewsletterTitle(domain: string, html: string, currentTitle: string): string {
    // only apply on this domain when the primary title is the newsletter text
    if (
        domain !== "joshuaweissman.com" ||
        !/get notified about new recipes/i.test(currentTitle)
    ) {
        return currentTitle;
    }

    // collect all h1 texts, then pick the first one that is *not* the newsletter
    const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
    const h1Texts: string[] = [];

    let h1Match: RegExpExecArray | null;
    while ((h1Match = h1Regex.exec(html)) !== null) {
        const innerRaw = h1Match[1] ?? "";
        const text = decodeHtmlEntities(
            innerRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
        );

        if (text) {
            h1Texts.push(text);
        }
    }

    // prefer the first h1 that is not the generic newsletter header
    const altTitle =
        h1Texts.find(
            (text) => !/get notified about new recipes/i.test(text),
        ) ?? h1Texts[1];

    return altTitle || currentTitle;
}




// ENTRY POINT  -->  parse html for a given url into ParsedRecipe
export function parseRecipeHtml(url: string, html: string): ParsedRecipe {
    const domain = (() => {
        try {
            const parsed = new URL(url);
            return parsed.hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    })();

    // try json-ld first  -->  best on big sites like allrecipes, simplyrecipes, delish
    const fromJsonLd = parseFromJsonLd(html);

    if (fromJsonLd && fromJsonLd.ingredients.length > 0) {
        // if json-ld title is blank, fall back to html title meta
        const rawTitle = fromJsonLd.title || extractTitleFromHtml(html) || url;

        // domain-specific adjustment for joshuaweissman.com newsletter title
        const adjustedTitle = tweakNewsletterTitle(domain, html, rawTitle);

        // if json-ld didn't include servings, try html-based fallback
        const servings =
            fromJsonLd.servings !== null
                ? fromJsonLd.servings
                : extractServingsFromHtml(html);

        return {
            title: adjustedTitle,
            servings,
            ingredients: fromJsonLd.ingredients,
        };
    }

    // fallback  -->  find last ingredients heading then next directions heading  -->  <li> items in between
    const ingredientLines = parseFromIngredientsSection(html);
    const ingredients = normalizeIngredients(ingredientLines);

    // base title from meta / <title>
    const rawTitle = extractTitleFromHtml(html) || url;

    // domain-specific adjustment for joshuaweissman.com newsletter title
    const adjustedTitle = tweakNewsletterTitle(domain, html, rawTitle);

    // servings fallback from html text (e.g. "Serves 4")
    const servings = extractServingsFromHtml(html);

    return {
        title: adjustedTitle,
        servings,
        ingredients,
    };
}
