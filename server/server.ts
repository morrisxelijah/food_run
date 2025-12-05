import express from "express";  // import express to create the http server and define routes
import type { Application, Request, Response, ErrorRequestHandler, NextFunction } from "express";  // used to type the app parameters
import cors from "cors";  // allow cross-origin requests from the frontend
import { query, dbPool } from "./db";  // db connection + helper
import type { RecipeSummary, Recipe, Ingredient } from "../types";
import { parseRecipeFromUrl } from "./importService";  // basic scraper




// read the server port from the environment or fallback to default
const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 4000);
// host just for logs
const host = process.env.HOST ?? "http://localhost";
// create a new express application instance
const app = express();


// allow cross-origin requests from the vite dev server
app.use(cors());
// use built-in middleware to automatically parse json bodies
app.use(express.json());




// all api routes on the provided app instance
function registerRoutes(app: Application) {
    // health check endpoint used by the client to verify the api is running
    app.get("/health", (request: Request, response: Response) => {
        // health check payload with status and timestamp
        const payload = {
            status: "ok" as const,
            message: "api server is running",
            timestamp: new Date().toISOString(),
        };

        // respond with 200 and the json payload
        response.status(200).json(payload);
    });


    // import preview  -->  accept a recipe url and return parsed title + ingredients
    app.post("/import/preview", async (request: Request, response: Response, next: NextFunction) => {
        const body = request.body as { url?: string };

        // basic validation
        if (!body.url) {
            response.status(400).json({ error: "url is required." });
            return;
        }

        try {
            // delegate parsing to the import service
            const parsed = await parseRecipeFromUrl(body.url);

            response.status(200).json(parsed);

        } catch (error) {
            console.error("error parsing recipe url:", error);

            next(error);  // let the global error handler format the final response
        }
    });


    // list all recipes  -->  summaries for the recipes page
    app.get("/recipes", async (request: Request, response: Response) => {
        // error  -->  pool isn't set up
        if (!dbPool) {
            response.status(503).json({
                error: "database is not configured yet. set DATABASE_URL to enable recipes.",
            });
            return;
        }

        // grab basic recipe fields with newest entries first
        const sql = `SELECT id, title, source_url, servings    FROM recipes    ORDER BY created_at DESC
        `;

        // run the query and map the db fields
        const rows = await query<{
            id: string;
            title: string;
            source_url: string;
            servings: number | null;
        }>(sql);

        const recipes: RecipeSummary[] = rows.map((row) => ({
            id: row.id,
            title: row.title,
            sourceUrl: row.source_url,
            servings: row.servings,
        }));

        response.status(200).json(recipes);
    });

    
    // fetch 1 recipe and all of its ingredients
    app.get("/recipes/:id", async (request: Request, response: Response) => {
        if (!dbPool) {  // error handling
            response.status(503).json({ error: "database is not configured yet. set DATABASE_URL to enable recipes.", });
            return;
        }

        const recipeId = request.params.id;

        // join recipes  -->  recipe_ingredients and ingredients
        const sql = `
            SELECT
                r.id AS recipe_id,
                r.title,
                r.source_url,
                r.servings,
                ri.amount,
                ri.unit,
                ri.notes,
                i.name AS ingredient_name
            FROM recipes r
            LEFT JOIN recipe_ingredients ri
                ON ri.recipe_id = r.id
            LEFT JOIN ingredients i
                ON i.id = ri.ingredient_id
            WHERE r.id = $1
        `;

        const rows = await query<{
            recipe_id: string;
            title: string;
            source_url: string;
            servings: number | null;
            amount: string | null;  // numeric was coming back as string from postgres
            unit: string | null;
            notes: string | null;
            ingredient_name: string | null;
        }>(sql, [recipeId]);

        // does the recipe exist ?
        if (rows.length === 0) {
            response.status(404).json({ error: "recipe not found" });
            return;
        }

        // recipe base info is repeated in every row  -->  grab from the first row
        const first = rows[0];

        const ingredients: Ingredient[] = rows
            .filter((row) => row.ingredient_name !== null)  // no ingredient names ?  -->  recipe doesn't have ingredients yet
            .map((row) => ({
                name: row.ingredient_name as string,
                amount: row.amount !== null ? Number(row.amount) : null,
                unit: row.unit,
                notes: row.notes,
            }));

        const recipe: Recipe = {
            id: first.recipe_id,
            title: first.title,
            sourceUrl: first.source_url,
            servings: first.servings,
            ingredients,
        };

        response.status(200).json(recipe);
    });


    // create a new recipe with its ingredients
    app.post("/recipes", async (request: Request, response: Response, next: NextFunction) => {
        if (!dbPool) {  // error handling
            response.status(503).json({ error: "database is not configured yet. set DATABASE_URL to enable recipes.", });
            return;
        }

        // shape expected from the client
        const body = request.body as {
            title?: string;
            sourceUrl?: string;
            servings?: number | null;
            ingredients?: Array<{
                name?: string;
                amount?: number | null;
                unit?: string | null;
                notes?: string | null;
            }>;
        };

        const { title, sourceUrl, servings = null, ingredients = [] } = body;

        
        // error handling
        // make sure required fields are present
        if (!title || !sourceUrl) {
            response.status(400).json({ error: "title and sourceUrl are required fields.", });
            return;
        }
        // ingredients must be an array, even if empty
        if (!Array.isArray(ingredients)) {
            response.status(400).json({ error: "ingredients must be an array.", });
            return;
        }

        
        // 1 transaction  -->  create recipe + ingredients as a single unit
        const client = await dbPool.connect();

        try {
            await client.query("BEGIN");

            // insert the recipe row and capture the generated uuid
            const recipeInsertSql = `
                INSERT INTO recipes (title, source_url, servings)
                VALUES ($1, $2, $3)
                RETURNING id, title, source_url, servings
            `;

            const recipeResult = await client.query<{
                id: string;
                title: string;
                source_url: string;
                servings: number | null;
            }>(recipeInsertSql, [title, sourceUrl, servings]);

            const recipeRow = recipeResult.rows[0];

            // insert each ingredient and link it to the recipe in the join table
            for (const ingredient of ingredients) {
                if (!ingredient || !ingredient.name)  continue;  // skip invalid entries

                const ingredientInsertSql = `
                    INSERT INTO ingredients (name, canonical_name, default_unit)
                    VALUES ($1, $2, $3)
                    RETURNING id
                `;

                const ingredientResult = await client.query<{ id: string }>(
                    ingredientInsertSql,
                    [
                        ingredient.name,
                        ingredient.name.toLowerCase(),  // canonical form for now
                        ingredient.unit ?? "count",  // fallback unit
                    ]
                );

                const ingredientRow = ingredientResult.rows[0];

                const joinInsertSql = `
                    INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit, notes)
                    VALUES ($1, $2, $3, $4, $5)
                `;

                await client.query(joinInsertSql, [
                    recipeRow.id,
                    ingredientRow.id,
                    ingredient.amount ?? null,
                    ingredient.unit ?? null,
                    ingredient.notes ?? null,
                ]);
            }

            await client.query("COMMIT");

            // build recipe
            const created: Recipe = {
                id: recipeRow.id,
                title: recipeRow.title,
                sourceUrl: recipeRow.source_url,
                servings: recipeRow.servings,
                ingredients: ingredients
                    .filter((ingredient) => ingredient && ingredient.name)
                    .map((ingredient) => ({
                        name: ingredient.name as string,
                        amount: ingredient.amount ?? null,
                        unit: ingredient.unit ?? null,
                        notes: ingredient.notes ?? null,
                    })),
            };

            response.status(201).json(created);

        } catch (error) {
            await client.query("ROLLBACK");  // cancel adding if anything failed

            next(error);  // pass to global error handler

        } finally {
            client.release();  // close the connection
        }
    });




  // additional routes (shopping list, import) will be added here later
}


// register all routes (endpoints) for the application
registerRoutes(app);




// global error handler  -->  catch errors from routes and middleware
const errorHandler: ErrorRequestHandler = ( error: unknown, request: Request, response: Response, next: NextFunction
) => {
    // log the error to the server console for debugging during development
    console.error("unhandled error in request:", error);

    // generic error response
    const payload = {
        error: "internal server error",
    };

    // send a 500 response with the generic payload
    response.status(500).json(payload);
};


// register the global error handler as the last middleware
app.use(errorHandler);





// start the server listening on the configured port
app.listen(port, () => {
    // message (log)  ->  server started successfully 
    console.log(`food run api server  -->  listening on port ${port} \n    check health here:  ${host}:${port}/health`);
});