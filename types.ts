// representes the shape of the data (shared with client and server)



// a single ingredient in a recipe or shopping list
export interface Ingredient {
    name: string;  // name of the ingredient, e.g. "yellow onion"
    
    amount: number | null;  // numeric amount if known, e.g. 2 or 0.5, null if unknown or not parsed yet
    
    unit: string | null;  // unit for the ingredient, e.g. "cups", "tbsp", "g", or null if not known

    notes?: string | null;  // optional prep notes, e.g. "finely chopped"
}




// minimal version of a recipe imported or created in the app  -->  compact for quick UI visuals (lists / ccards)
export interface RecipeSummary {
    id: string;  // unique id for the recipe (will come from the database later)

    title: string;  // e.g. "keto chili"

    sourceUrl: string;  // original url where the recipe was found

    servings: number | null;  // how many servings the recipe is written for
}


// a full recipe including its ingredient list
export interface Recipe extends RecipeSummary {
    ingredients: Ingredient[];  // array of objs listing ingredients associated with this recipe
}




// the server health response used by the client
export interface HealthStatus {
    status: "ok" | "error";  // overall status

    message?: string;  // optional message with extra details about the health check

    timestamp?: string;  // timestamp string from the server when the health was checked
}
