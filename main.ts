import { parseArgs } from "jsr:@std/cli@^0.224.5";
import { bold, red } from "jsr:@std/fmt@^0.225.4/colors";
import pkg from "./deno.json" with { type: "json" };

const help = `
Run recipes defined in a cookbook

Usage:
  cook [OPTIONS] [RECIPE] [ARGUMENTS]

Options:
  -l, --list     List all recipes along with their parameters
  -v, --version  Print version and exit
  -h, --help     Print this help message
`.trim();

type Recipe = {
    name: string;
    parameters: string[];
    rest: boolean;
    signature: string;
    body: string;
};

function print(recipe: Recipe) {
    let indentation = 0;
    while (recipe.body[indentation] === " ") {
        indentation++;
    }
    for (const line of recipe.body.split("\n")) {
        console.log(`> ${line.substring(indentation)}`);
    }
}

function run(recipe: Recipe, args: string[]) {
    const env: Record<string, string> = {};
    for (let i = 0; i < recipe.parameters.length; i++) {
        env[recipe.parameters[i]] = args[i];
    }
    return new Deno.Command(Deno.env.get("SHELL") ?? "/bin/sh", {
        args: [
            "-c",
            recipe.body,
            recipe.name,
            ...args.slice(recipe.parameters.length),
        ],
        env,
    }).spawn().status;
}

function parseCookbook(text: string) {
    const commentPattern = "#.*\n| *\n";
    const recipePattern = `(?:${commentPattern})*([^# ].*\n)((?: .*\n|\n)*)`;
    const cookbookPattern = `^(${recipePattern})*(${commentPattern})*$`;

    if (!new RegExp(cookbookPattern).test(text)) {
        throw Error("malformed cookbook");
    }

    const cookbook = [];
    for (const match of text.matchAll(new RegExp(recipePattern, "g"))) {
        const signature = match[1].trimEnd();
        const body = match[2].trimEnd();

        const [name, ...parameters] = signature.split(/\s+/);

        let rest = false;
        if (parameters[parameters.length - 1] === "...") {
            parameters.pop();
            rest = true;
        }

        cookbook.push({ name, parameters, rest, signature, body });
    }

    return cookbook;
}

async function main() {
    const flags = ["list", "version", "help"];
    const alias: Record<string, string> = {};
    for (const flag of flags) {
        alias[flag] = flag[0];
    }
    const args = parseArgs(Deno.args, {
        boolean: flags,
        alias,
        stopEarly: true,
        string: ["_"],
        unknown(arg) {
            if (arg.startsWith("-")) {
                throw Error(`unknown option: ${arg}`);
            }
        },
    });

    if (args.help || Deno.args.length === 0) {
        console.log(help);
        return;
    }

    if (args.version) {
        console.log(`cook ${pkg.version}`);
        return;
    }

    // Normalise to end in exactly one newline because it makes the parsing simpler
    const text = (await Deno.readTextFile("cookbook")).trim() + "\n";
    const cookbook = parseCookbook(text);

    if (args.list) {
        for (const recipe of cookbook) {
            console.log(recipe.signature);
        }
        return;
    }

    const [recipeName, ...recipeArgs] = args._;
    for (const recipe of cookbook) {
        if (
            recipe.name === recipeName &&
            (recipe.parameters.length === recipeArgs.length ||
                recipe.rest && recipe.parameters.length <= recipeArgs.length)
        ) {
            print(recipe);
            const status = await run(recipe, recipeArgs);
            Deno.exit(status.code);
        }
    }

    throw Error(`recipe not found: ${recipeName} ${recipeArgs.length}`);
}

try {
    await main();
} catch (err) {
    console.error(`${bold(red("error"))}: ${err.message}`);
    Deno.exit(1);
}
