// this page will list recipes that have already been saved in the system


import { useEffect, useState } from "react";
import type { RecipeSummary, Recipe, Ingredient } from "../../types";
import { fetchRecipes, fetchRecipeById } from "../api";  // loads recipes + details from the server




// details state stored per recipe id  -->  cache results and track loading / errors separately
interface RecipeDetailsState {
    [recipeId: string]: {
        recipe: Recipe | null;
        isLoading: boolean;
        errorMessage: string | null;
    };
}




export default function RecipesPage() {
    const [recipes, setRecipes] = useState<RecipeSummary[]>([]);  // list of recipes returned from the api

    // for refreshing the page + showing errors
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // which recipes are currently expanded to show ingredient details (allows multiple open at once)
    const [expandedRecipeIds, setExpandedRecipeIds] = useState<string[]>([]);

    // cached details + loading / error state per recipe id
    const [detailsById, setDetailsById] = useState<RecipeDetailsState>({});
    

    // when this page first mounts, load recipes from the server
    useEffect(() => {
        const loadRecipes = async () => {
            try {
                const data = await fetchRecipes(); // call api helper
                setRecipes(data);  // store the results in state for UI
                setErrorMessage(null);  // clear any previous errors

            } catch (error) {
                console.error("error loading recipes:", error);
                setErrorMessage("unable to load recipes right now. please try again.");

            } finally {
                setIsLoading(false);  // loading is complete whether it succeeded or failed
            }
        };

        loadRecipes();
    }, []);

    


    // helper  -->  fetch and display full details for selected recipe(s)
    const toggleIngredients = async (recipeId: string) => {
        // expanded already ?
        const isCurrentlyExpanded = expandedRecipeIds.includes(recipeId);
        // if yes  -->  collapse it and exit
        if (isCurrentlyExpanded) {
            setExpandedRecipeIds((current) => current.filter((id) => id !== recipeId));
            return;
        }
        // if no  -->  expand this recipe (allow for multiple open at once)
        setExpandedRecipeIds((current) => [...current, recipeId]);

        // details cached with no error ?  -->  do not re-fetch
        const existingDetails = detailsById[recipeId];
        if (existingDetails && existingDetails.recipe && !existingDetails.errorMessage)  return;


        // set this recipe as loading
        setDetailsById((current) => ({ ...current,
            [recipeId]: {
                recipe: existingDetails?.recipe ?? null,
                isLoading: true,
                errorMessage: null,
            },
        }));

        try {
            const recipe = await fetchRecipeById(recipeId);  // call api helper to load the full recipe + ingredients

            // store in state so the card can render ingredients
            setDetailsById((current) => ({  ...current,
                [recipeId]: {
                    recipe,
                    isLoading: false,
                    errorMessage: null,
                },
            }));

        } catch (error) {
            console.error("error loading recipe details:", error);

            setDetailsById((current) => ({
                ...current,
                [recipeId]: {
                    recipe: null,
                    isLoading: false,
                    errorMessage:
                        "unable to load ingredients for this recipe right now. please try again.",
                },
            }));
        }
    };


    // helper  -->  render the main body content
    const renderContent = () => {
        // still loading recipe list ?
        if (isLoading)  return <p>loading saved recipes...</p>;

        // error while loading ?
        if (errorMessage)  return <p className="recipes-error-text">{errorMessage}</p>;

        // load success  -->  no recipes found
        if (recipes.length === 0)  return (
                <p>no recipies saved yet !  after a recipe is imported, it will show up here. check out the <strong>IMPORT</strong> tab</p>
            );

        // load success  -->  one or more recipes (mobile-first)
        return (
            <ul className="recipe-list">
                {recipes.map((recipe) => {
                    const isExpanded = expandedRecipeIds.includes(recipe.id);  // show extra detail (ingredients) or not
                    const details = detailsById[recipe.id];  // details state for this recipe id (if any)

                    
                    return (
                        <li key={recipe.id} className="recipe-list-item">
                            {/* base summary info for the recipe card */}
                            <h2 className="recipe-list-item__title">{recipe.title}</h2>

                            <p className="recipe-list-item__meta">
                                servings:{" "}
                                {recipe.servings !== null ? recipe.servings : "not specified"}
                            </p>

                            <p className="recipe-list-item__source"> {recipe.sourceUrl} </p>

                            {/* toggles the details section inside this card */}
                            <button
                                type="button"
                                className="recipe-list-item__details-button"
                                onClick={() => toggleIngredients(recipe.id)}
                            >
                                {isExpanded ? "hide ingredients" : "view ingredients"}
                            </button>

                            {/* details panel  -->  only rendered when this card is expanded (onClick) */}
                            {isExpanded && (
                                <div className="recipe-list-item__details">
                                    {/* loading state for this recipe's details */}
                                    {details?.isLoading && (
                                        <p>loading ingredients...</p>
                                    )}

                                    {/* error state for this recipe's details */}
                                    {details?.errorMessage && !details.isLoading && (
                                        <p className="recipes-error-text">
                                            {details.errorMessage}
                                        </p>
                                    )}

                                    {/* final ingredients list when we have data and no error */}
                                    {details &&
                                        !details.isLoading &&
                                        !details.errorMessage &&
                                        details.recipe && (
                                            <>
                                                {details.recipe.ingredients.length === 0 ? (
                                                    <p>
                                                        no ingredients saved yet for this recipe.
                                                    </p>
                                                ) : (
                                                    <ul className="recipe-ingredients-list">
                                                        {details.recipe.ingredients.map(
                                                            (ingredient: Ingredient, index: number) => (
                                                                <li
                                                                    key={index}
                                                                    className="recipe-ingredients-list__item"
                                                                >
                                                                    <span className="recipe-ingredients-list__name">
                                                                        {ingredient.name}{"  →  "}
                                                                    </span>

                                                                    <span className="recipe-ingredients-list__meta">
                                                                        {ingredient.amount !== null
                                                                            ? ingredient.amount
                                                                            : ""}
                                                                        {"  "}
                                                                        {ingredient.unit ?? ""}
                                                                    </span>
                                                                </li>
                                                            )
                                                        )}
                                                    </ul>
                                                )}
                                            </>
                                        )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        );
    };
    


    
    return (
        <section>
            <h1>Saved Recipes</h1>

            {/* placeholder description */}
            <p>
                This page will show imported recipes, including their titles and main ingredients. <br></br> 
                From here you will eventually be able to select recipes for planning and editing.
            </p>

            <div className="recipes-layout">
                {/* dynamic content based on loading / error / data state */}
                {renderContent()}
            </div>
        </section>
    );
}
