-- purpose:
    -- keep a versioned copy of my DB schema with git
    -- create supabase (prod) and local postgres (dev) from the same script 
    -- make new tables from here so both versions are on the same page




-- used to generate UUIDs in postgres / supabase  ;  similar to bcrypt but for DBs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";




-- recipes table  -->  one row per recipe imported or created in Food Run
CREATE TABLE IF NOT EXISTS recipes (
    -- primary key  -->  generate a random UUID by default
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- human-readable recipe name  -->  e.g. "keto chili"
    title text NOT NULL,

    -- original URL where the recipe came from
    source_url text NOT NULL,

    -- how many servings the recipe is written for
    servings integer,

    -- timestamps for tracking when rows were added / updated  -->  default to current time
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);




-- ingredients table  -->  global dictionary of ingredients  ;  shared across recipes for aggregation
CREATE TABLE IF NOT EXISTS ingredients (
    -- primary key for the ingredient
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- name of the ingredient  -->  e.g. "yellow onion"
    name text NOT NULL,

    -- optional normalized / lexical name to help with matching later
    canonical_name text,

    -- default unit when not specified  -->  e.g. "count", "pieces", "g", "ml"
    default_unit text,

    created_at timestamptz NOT NULL DEFAULT now()
);




-- recipe_ingredients  join table  -->  link recipes to ingredients with per-recipe amounts/units
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    -- primary key for this linking row
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- foreign key to the recipe this ingredient belongs to
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

    -- foreign key to the shared ingredient record
    ingredient_id uuid NOT NULL REFERENCES ingredients(id),

    -- can be null or decimals (e.g. 0.5, 1.25)
    amount numeric(10, 2),

    -- normalized unit (e.g. "g", "ml", "cup", "tbsp")  -->  will use for conversions
    unit text,

    -- optional notes about prep  -->  e.g. "finely chopped"
    notes text,

    created_at timestamptz NOT NULL DEFAULT now()
);




-- indexes  -->  most likely won't need these since my DB is small but it could be great for performance if I did

-- speed up lookups by recipe
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id
    ON recipe_ingredients (recipe_id);

-- speed up lookups by ingredient
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_ingredient_id
    ON recipe_ingredients (ingredient_id);