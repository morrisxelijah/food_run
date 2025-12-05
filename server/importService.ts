// helper functions for scraping recipe pages into a structured format


import * as cheerio from "cheerio";  // server-side html parser (jquery-like api)
import type { Ingredient } from "../types";  // shared ingredient shape for ui + db
import { parseRecipeHtml } from "./recipeParser";  // helper  -->  generic html parser (json-ld + headings)




// shape of a parsed recipe preview returned to the client
export interface ParsedRecipePreview {
    title: string;  // best-guess from the page
    sourceUrl: string;  // original url
    servings: number | null;  // parsed if found
    ingredients: Ingredient[];  // best guess ingredients list  -->  user will confirm / edit
}




// basic parser for "amount unit name" strings, e.g. "1 cup rice", "2 onions"
function parseIngredientText(rawText: string): Ingredient {
    // normalize whitespace and strip extra spaces/newlines
    const text = rawText.trim().replace(/\s+/g, " ");

    // default ingredient shape  -->  name only, rest null
    let amount: number | null = null;
    let unit: string | null = null;
    let name = text;

    // simple split  -->  first token might be a number like "1" or "0.5"
    const parts = text.split(" ");

    // try to parse the first token as a number
    const maybeAmount = Number(parts[0]);

    if (!Number.isNaN(maybeAmount)) {
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

    // user will clean up in the ui
    return {
        name,
        amount,
        unit,
        // notes is optional on the type  -->  left undefined for now
    };
}




// helper  -->  select text from elements
function getCleanText($: cheerio.CheerioAPI, selector: string): string | null {
    const text = $(selector).first().text().trim();
    return text.length > 0 ? text : null;
}




// parser for allrecipes.com pages
function parseAllRecipes(html: string, url: string): ParsedRecipePreview {
    const $ = cheerio.load(html);

    // title  -->  usually in the main h1
    const title = getCleanText($, "h1") ?? "Imported recipe (title not found)";

    // will try a few selectors then fall back to null
    let servings: number | null = null;

    const servingsText =
        $("div.recipe-adjust-servings__size, input#servings")
            .first()
            .val()
            ?.toString() ??
        $("div.mntl-recipe-details__value")
            .filter((_, el) =>
                $(el).prev().text().toLowerCase().includes("servings"),
            )
            .first()
            .text()
            .trim();

    if (servingsText) {
        const maybeServings = Number(servingsText);
        if (!Number.isNaN(maybeServings)) {
            servings = maybeServings;
        }
    }

    const ingredients: Ingredient[] = [];

    // modern allrecipes  -->  "mntl-structured-ingredients" components
    $("ul.mntl-structured-ingredients__list li").each((_, li) => {
        const text = $(li).text().trim();
        if (text.length === 0) return;

        ingredients.push(parseIngredientText(text));
    });

    // fallback for older style  -->  span.ingredients-item-name
    if (ingredients.length === 0) {
        $("span.ingredients-item-name").each((_, span) => {
            const text = $(span).text().trim();
            if (text.length === 0) return;

            ingredients.push(parseIngredientText(text));
        });
    }

    return {
        title,
        sourceUrl: url,
        servings,
        ingredients,
    };
}




// parser for simplyrecipes.com pages
function parseSimplyRecipes(html: string, url: string): ParsedRecipePreview {
    const $ = cheerio.load(html);

    const title =
        getCleanText($, "h1") ??
        "Imported recipe (title not found)";

    let servings: number | null = null;

    // simply recipes often has "Servings" displayed in a data row  -->  try to locate by label
    $("div").each((_, el) => {
        const label = $(el).text().toLowerCase();
        if (label.includes("serves") || label.includes("servings")) {
            const match = label.match(/(\d+)/);
            if (match) {
                const maybe = Number(match[1]);
                if (!Number.isNaN(maybe)) {
                    servings = maybe;
                }
            }
        }
    });

    const ingredients: Ingredient[] = [];

    // many simply recipes pages group ingredients in <ul> lists under an "Ingredients" heading
    $("h2, h3").each((_, heading) => {
        const headingText = $(heading).text().toLowerCase();
        if (!headingText.includes("ingredient")) return;

        // look for the next <ul> after the heading
        const list = $(heading).nextAll("ul").first();
        list.find("li").each((__, li) => {
            const text = $(li).text().trim();
            if (text.length === 0) return;

            ingredients.push(parseIngredientText(text));
        });
    });

    return {
        title,
        sourceUrl: url,
        servings,
        ingredients,
    };
}




// parser for delish.com pages
function parseDelish(html: string, url: string): ParsedRecipePreview {
    const $ = cheerio.load(html);

    const title =
        getCleanText($, "h1") ??
        "Imported recipe (title not found)";

    let servings: number | null = null;

    // try to find "servings" in meta / labels
    $("div, span, p").each((_, el) => {
        const text = $(el).text().toLowerCase();
        if (text.includes("servings") || text.includes("serves")) {
            const match = text.match(/(\d+)/);
            if (match) {
                const maybe = Number(match[1]);
                if (!Number.isNaN(maybe)) {
                    servings = maybe;
                }
            }
        }
    });

    const ingredients: Ingredient[] = [];

    // delish typically uses ingredients lists near a heading that says "Ingredients"
    $("h2, h3").each((_, heading) => {
        const headingText = $(heading).text().toLowerCase();
        if (!headingText.includes("ingredient")) return;

        const list = $(heading).nextAll("ul").first();
        list.find("li").each((__, li) => {
            const text = $(li).text().trim();
            if (text.length === 0) return;

            ingredients.push(parseIngredientText(text));
        });
    });

    return {
        title,
        sourceUrl: url,
        servings,
        ingredients,
    };
}




// parser for joshuaweissman.com pages
// goal  -->  be more flexible and avoid cheerio Element / AnyNode typing issues
function parseJoshuaWeissman(
    html: string,
    url: string,
    fallbackTitle: string,
    fallbackServings: number | null,
): ParsedRecipePreview {
    const $ = cheerio.load(html);

    // title  -->  prefer fallback (generic parser) and only use h1 if fallback is empty
    const h1Title = getCleanText($, "h1");
    const title =
        fallbackTitle && fallbackTitle.trim().length > 0
            ? fallbackTitle
            : h1Title ?? "Imported recipe (title not found)";

    // servings  -->  scan body text for "serves 4" or "4 servings"
    let servings: number | null = null;
    const bodyText = $("body").text().toLowerCase();

    const servesMatch =
        bodyText.match(/serves\s+(\d+)/) ??
        bodyText.match(/serves:\s*(\d+)/);
    const servingsMatch =
        servesMatch ??
        bodyText.match(/(\d+)\s+servings?/);

    if (servingsMatch) {
        const maybe = Number.parseInt(servingsMatch[1], 10);
        if (!Number.isNaN(maybe)) {
            servings = maybe;
        }
    }

    // final servings  -->  prefer parsed value, else fallback from generic parser
    if (servings === null) {
        servings = fallbackServings;
    }

    const ingredients: Ingredient[] = [];

    // strategy  -->
    // 1. find the last heading that mentions "ingredients"
    // 2. walk forward through siblings until the next heading that looks like directions / instructions
    // 3. collect all <li> text inside that slice
    const headings = $("h1, h2, h3, h4, h5, h6").toArray();

    let ingredientsHeadingIndex = -1;

    headings.forEach((node, index) => {
        const text = $(node).text().toLowerCase();
        if (text.includes("ingredient")) {
            ingredientsHeadingIndex = index;
        }
    });

    if (ingredientsHeadingIndex !== -1) {
        const ingredientsHeading = headings[ingredientsHeadingIndex];

        // walk all following siblings after the ingredients heading
        $(ingredientsHeading)
            .nextAll()
            .each((_, el) => {
                const $el = $(el);

                // stop at a new major section like directions / instructions / method / steps
                if ($el.is("h1, h2, h3, h4, h5, h6")) {
                    const headingText = $el.text().toLowerCase();
                    if (
                        headingText.includes("direction") ||
                        headingText.includes("instruction") ||
                        headingText.includes("method") ||
                        headingText.includes("step")
                    ) {
                        // break out of the .each loop
                        return false;
                    }
                }

                // collect any <li> items inside this element
                $el.find("li").each((__, li) => {
                    const text = $(li).text().trim();
                    if (text.length === 0) return;

                    ingredients.push(parseIngredientText(text));
                });

                // keep walking siblings
                return undefined;
            });
    }

    return {
        title,
        sourceUrl: url,
        servings,
        ingredients,
    };
}




// main entry point
export async function parseRecipeFromUrl(
    url: string,
): Promise<ParsedRecipePreview> {
    // basic validation
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error("invalid recipe url");
    }

    console.log("[import] parsing url:", url);
    console.log("[import] hostname:", parsedUrl.hostname);

    // fetch the html from the website
    const response = await fetch(url, {
        headers: {
            // pretend to be a normal browser to avoid basic bot blocks
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/120.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
        },
    });

    if (!response.ok) {
        console.error("[import] fetch failed. status:", response.status);
        throw new Error(
            `failed to fetch recipe page. status: ${response.status}`,
        );
    }

    const html = await response.text();

    // first pass  -->  use the generic html parser (json-ld + ingredients section heuristic)
    const genericParsed = parseRecipeHtml(url, html);

    console.log("[import] generic parser result:", {
        title: genericParsed.title,
        servings: genericParsed.servings,
        ingredientCount: genericParsed.ingredients.length,
        sampleIngredients: genericParsed.ingredients.slice(0, 3),
    });

    // prefer generic parser when it has ingredients
    if (genericParsed.ingredients.length > 0) {
        console.log("[import] using generic parser result");
        return {
            title:
                genericParsed.title || "Imported recipe (title not found)",
            sourceUrl: url,
            servings: genericParsed.servings,
            ingredients: genericParsed.ingredients,
        };
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    console.log(
        "[import] generic parser found no ingredients. falling back by domain...",
    );

    const fallbackTitle =
        genericParsed.title || "Imported recipe (title not found)";
    const fallbackServings = genericParsed.servings;

    // generic parser returned no ingredients ?  -->  fall back to tuned domain parsers
    if (hostname.includes("allrecipes.com")) {
        return parseAllRecipes(html, url);
    }

    if (hostname.includes("simplyrecipes.com")) {
        return parseSimplyRecipes(html, url);
    }

    if (hostname.includes("delish.com")) {
        return parseDelish(html, url);
    }

    if (hostname.includes("joshuaweissman.com")) {
        return parseJoshuaWeissman(
            html,
            url,
            fallbackTitle,
            fallbackServings,
        );
    }

    // fallback  -->  best effort parser for unknown sites
    const $ = cheerio.load(html);
    const title =
        getCleanText($, "h1") ??
        fallbackTitle ??
        "Imported recipe (title not found)";
    const ingredients: Ingredient[] = [];

    // try any list under an ingredients heading
    $("h2, h3").each((_, heading) => {
        const headingText = $(heading).text().toLowerCase();
        if (!headingText.includes("ingredient")) return;

        const list = $(heading).nextAll("ul, ol").first();
        list.find("li").each((__, li) => {
            const text = $(li).text().trim();
            if (text.length === 0) return;

            ingredients.push(parseIngredientText(text));
        });
    });

    return {
        title,
        sourceUrl: url,
        servings: fallbackServings ?? null,
        ingredients,
    };
}
