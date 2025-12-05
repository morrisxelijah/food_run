// this page will handle pasting recipe urls and showing parsed ingredients


import { useState } from "react";
import type { Ingredient } from "../../types";
import { createRecipe } from "../api";




// local shape for editable ingredient rows in the import form
interface EditableIngredient {
    id: string;  // local id for React keys and editing
    name: string;  // ingredient name as typed by the user
    amount: string;  // string input, will be converted to number | null before sending
    unit: string; // string input, will be trimmed and converted to null when empty
}




// helper  -->  generate a local id for an ingredient row
function createRowId(): string {
    // use crypto.randomUUID when available (modern browsers)
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)  return crypto.randomUUID();

    // fallback if crypto fails (older browsers)
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}




// helper  -->  create a blank editable row
function createEmptyIngredient(): EditableIngredient {
    return {
        id: createRowId(),
        name: "",
        amount: "",
        unit: "",
    };
}




// helper  -->  title guess from the url (e.g. "keto-chili-recipe" -> "keto chili recipe")
function inferTitleFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
        if (!path) return "";

        return path
            .replace(/[-_]+/g, " ")
            .replace(/\.[a-zA-Z0-9]+$/, "")
            .trim();
    } catch {
        return "";
    }
}




export default function ImportRecipePage() {
    // step 1  -->  base recipe metadata
    const [recipeUrl, setRecipeUrl] = useState<string>("");
    const [recipeTitle, setRecipeTitle] = useState<string>("");
    const [servings, setServings] = useState<string>("");  // keep as string for input, convert later

    // step 2  -->  parsed but not yet confirmed ingredient rows
    const [ingredientRows, setIngredientRows] = useState<EditableIngredient[]>([]);

    // state for parse step
    const [isParsing, setIsParsing] = useState<boolean>(false);
    const [parseErrorMessage, setParseErrorMessage] = useState<string | null>(null);

    // state for save step
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);




    // step 1  -->  simulate parsing when the user clicks "parse ingredients"
    const handleParseIngredients = async (event: React.FormEvent) => {
        event.preventDefault();

        // clear previous messages
        setParseErrorMessage(null);
        setSaveErrorMessage(null);
        setSuccessMessage(null);

        const trimmedUrl = recipeUrl.trim();

        // require a url for the flow to make sense
        if (!trimmedUrl) {
            setParseErrorMessage("please paste a recipe url to import.");
            return;
        }

        setIsParsing(true);

        try {
            // if no title provided yet, try to infer something from the url path
            if (!recipeTitle.trim()) {
                const inferredTitle = inferTitleFromUrl(trimmedUrl);
                if (inferredTitle) {
                    setRecipeTitle(inferredTitle);
                }
            }

            // for now, if no rows exist yet, seed with a couple of example rows
            // this simulates "parsed but not yet confirmed" ingredients
            setIngredientRows((current) => {
                if (current.length > 0) {
                    // already have rows (maybe user is re-parsing)  -->  keep them
                    return current;
                }

                return [
                    {
                        id: createRowId(),
                        name: "",
                        amount: "",
                        unit: "",
                    },
                    {
                        id: createRowId(),
                        name: "",
                        amount: "",
                        unit: "",
                    },
                ];
            });

        } finally {
            setIsParsing(false);
        }
    };




    // helper  -->  update a single field on a single ingredient row
    const handleIngredientFieldChange = (
        rowId: string,
        field: keyof EditableIngredient,
        value: string
    ) => {
        setIngredientRows((current) =>
            current.map((row) =>
                row.id === rowId
                    ? { ...row, [field]: value }
                    : row
            )
        );
    };




    // helper  -->  add a new blank ingredient row
    const addIngredient = () => {
        setIngredientRows((current) => [...current, createEmptyIngredient()]);
    };




    // helper  -->  remove a specific ingredient row
    const removeIngredient = (rowId: string) => {
        setIngredientRows((current) =>
            current.filter((row) => row.id !== rowId)
        );
    };




    // step 2  -->  save recipe + confirmed ingredients to the backend
    const handleSaveRecipe = async (event: React.FormEvent) => {
        event.preventDefault();

        setSaveErrorMessage(null);
        setSuccessMessage(null);

        const trimmedUrl = recipeUrl.trim();
        const trimmedTitle = recipeTitle.trim();

        // basic validation  -->  require title + url for the recipe
        if (!trimmedUrl || !trimmedTitle) {
            setSaveErrorMessage("please provide both a recipe title and a recipe url.");
            return;
        }

        // build a normalized ingredient array for the API payload
        const normalizedIngredients: Ingredient[] = ingredientRows
            // ignore rows with no name at all
            .filter((row) => row.name.trim().length > 0)
            .map((row) => {
                const trimmedName = row.name.trim();
                const trimmedAmount = row.amount.trim();
                const trimmedUnit = row.unit.trim();

                // convert amount string into number | null
                const numericAmount =
                    trimmedAmount === "" ? null : Number.parseFloat(trimmedAmount);

                return {
                    name: trimmedName,
                    amount: Number.isNaN(numericAmount) ? null : numericAmount,
                    unit: trimmedUnit === "" ? null : trimmedUnit,
                };
            });

        // optional servings conversion  -->  keep null when empty or invalid
        let parsedServings: number | null = null;
        const trimmedServings = servings.trim();
        if (trimmedServings !== "") {
            const asNumber = Number.parseInt(trimmedServings, 10);
            parsedServings = Number.isNaN(asNumber) ? null : asNumber;
        }

        // require at least one ingredient to save a meaningful recipe
        if (normalizedIngredients.length === 0) {
            setSaveErrorMessage("please add at least one ingredient before saving.");
            return;
        }

        setIsSaving(true);

        try {
            // call the api helper to create the recipe in the database
            const createdRecipe = await createRecipe({
                title: trimmedTitle,
                sourceUrl: trimmedUrl,
                servings: parsedServings,
                ingredients: normalizedIngredients,
            });

            // success  -->  show a small confirmation and reset ingredient rows
            setSuccessMessage(
                `recipe "${createdRecipe.title}" was saved successfully.`
            );

            // leave url/title/servings for now so user can tweak and re-save variants if they want
            setIngredientRows([]);

        } catch (error) {
            console.error("error saving recipe:", error);
            setSaveErrorMessage(
                "unable to save this recipe right now. please try again."
            );

        } finally {
            setIsSaving(false);
        }
    };




    // helper  -->  render the ingredient editing section (step 2)
    const renderIngredientEditor = () => {
        // if we have not "parsed" yet, keep the UI lean
        if (ingredientRows.length === 0) {
            return null;
        }

        return (
            <div className="import-ingredients">
                <h2>Step 2: review and edit ingredients</h2>

                <p>
                    These ingredients represent the parsed list for this recipe.{" "}
                    You can edit names, amounts, and units before saving to Food Run.
                </p>

                <div className="import-ingredients__rows">
                    {ingredientRows.map((row) => (
                        <div
                            key={row.id}
                            className="import-ingredients__row"
                        >
                            <label className="import-ingredients__field">
                                <span>ingredient:{"  "}</span>
                                <input
                                    type="text"
                                    value={row.name}
                                    onChange={(event) =>
                                        handleIngredientFieldChange(
                                            row.id,
                                            "name",
                                            event.target.value
                                        )
                                    }
                                    placeholder="yellow onion"
                                />
                            </label>

                            <label className="import-ingredients__field">
                                <span>amount:{"  "}</span>
                                <input
                                    type="text"
                                    value={row.amount}
                                    onChange={(event) =>
                                        handleIngredientFieldChange(
                                            row.id,
                                            "amount",
                                            event.target.value
                                        )
                                    }
                                    placeholder="1.5"
                                />
                            </label>

                            <label className="import-ingredients__field">
                                <span>unit:{"  "}</span>
                                <input
                                    type="text"
                                    value={row.unit}
                                    onChange={(event) =>
                                        handleIngredientFieldChange(
                                            row.id,
                                            "unit",
                                            event.target.value
                                        )
                                    }
                                    placeholder="cups, g, ml, count..."
                                />
                            </label>

                            <button
                                type="button"
                                className="import-ingredients__remove"
                                onClick={() => removeIngredient(row.id)}
                            >
                                remove
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    className="import-ingredients__add"
                    onClick={addIngredient}
                >
                    + add ingredient
                </button>
            </div>
        );
    };




    return (
        <section>
            <h1>Import Recipes</h1>

            {/* flow description */}
            <p>
                Paste a recipe url here to import its title and ingredient list into food run. <br></br> 
                There will be a review with otional clean up before saving.
            </p>

            {/* step 1  -->  base recipe info + parse trigger */}
            <form className="import-form" onSubmit={handleParseIngredients}>
                <h2>Step 1: paste the recipe url</h2>

                <label className="import-form__field">
                    <span>recipe url</span>
                    <input
                        type="url"
                        value={recipeUrl}
                        onChange={(event) => setRecipeUrl(event.target.value)}
                        placeholder="https://example.com/your-favorite-recipe"
                        required
                    />
                </label>

                <label className="import-form__field">
                    <span>recipe title</span>
                    <input
                        type="text"
                        value={recipeTitle}
                        onChange={(event) => setRecipeTitle(event.target.value)}
                        placeholder="keto chili"
                    />
                </label>

                <label className="import-form__field">
                    <span>servings (optional)</span>
                    <input
                        type="number"
                        min="1"
                        value={servings}
                        onChange={(event) => setServings(event.target.value)}
                        placeholder="4"
                    />
                </label>

                {parseErrorMessage && (
                    <p className="import-form__error">{parseErrorMessage}</p>
                )}

                <button
                    type="submit"
                    className="import-form__parse-button"
                    disabled={isParsing}
                >
                    {isParsing ? "parsing..." : "parse ingredients"}
                </button>
            </form>

            
            {/* step 2  -->  ingredient editor and save button */}
            {renderIngredientEditor()}

            {ingredientRows.length > 0 && (
                <form className="import-save-form" onSubmit={handleSaveRecipe}>
                    {saveErrorMessage && (
                        <p className="import-save-form__error">
                            {saveErrorMessage}
                        </p>
                    )}

                    {successMessage && (
                        <p className="import-save-form__success">
                            {successMessage}
                        </p>
                    )}

                    <button
                        type="submit"
                        className="import-save-form__submit"
                        disabled={isSaving}
                    >
                        {isSaving ? "saving..." : "save recipe to Food Run"}
                    </button>
                </form>
            )}
        </section>
    );
}
