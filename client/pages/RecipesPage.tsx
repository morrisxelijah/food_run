// this page will list recipes that have already been saved in the system


import { useEffect, useState } from "react";
import type { RecipeSummary } from "../../types";
import { fetchRecipes } from "../api";  // loads recipes from the server




export default function RecipesPage() {
    const [recipes, setRecipes] = useState<RecipeSummary[]>([]);  // list of recipes returned from the api

    // for refreshing the page + showing errors
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    

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


    // helper  -->  render the body content
    const renderContent = () => {
        // still loading ?
        if (isLoading)  return <p>loading your saved recipes...</p>;

        // error while loading ?
        if (errorMessage)  return <p className="recipes-error-text">{errorMessage}</p>;

        // load success  -->  no recipes found
        if (recipes.length === 0)  return (
                <p>no recipies saved yet !  after you import a recipe, it will show up here.</p>
            );

        // load success  -->  one or more recipes (mobile-first)
        return (
            <ul className="recipe-list">
                {recipes.map((recipe) => (
                    <li key={recipe.id} className="recipe-list-item">
                        <h2 className="recipe-list-item__title">{recipe.title}</h2>

                        <p className="recipe-list-item__meta">
                            servings:{" "}
                            {recipe.servings !== null ? recipe.servings : "not specified"}
                        </p>

                        <p className="recipe-list-item__source">
                            {recipe.sourceUrl}
                        </p>
                    </li>
                ))}
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

            {/* dynamic content based on loading/error/data state */}
            {renderContent()}
        </section>
    );
}
