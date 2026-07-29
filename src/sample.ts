import type { RecipeTree } from "../shared/schema";

// The espresso brownie table that inspired this project — used as the demo
// recipe on the idle screen.
export const SAMPLE_RECIPE: RecipeTree = {
  title: "Espresso Brownies",
  setup: ["Butter and flour an 8x8-in pan.", "Preheat oven to 350°F (170°C)."],
  tree: {
    kind: "step",
    label: "bake 350°F (170°C) 30 to 40 min",
    children: [
      {
        kind: "step",
        label: "fold in",
        children: [
          {
            kind: "step",
            label: "mix",
            children: [
              {
                kind: "step",
                label: "mix",
                children: [
                  {
                    kind: "step",
                    label: "melt",
                    children: [
                      { kind: "ingredient", quantity: "4 oz (115 g)", name: "unsalted butter" },
                    ],
                  },
                  { kind: "ingredient", quantity: "1 cup (200 g)", name: "sugar" },
                  { kind: "ingredient", quantity: "1/4 tsp. (2.5 mL)", name: "vanilla extract" },
                  {
                    kind: "ingredient",
                    quantity: "1 shot (4 Tbs; 60 mL)",
                    name: "fresh brewed espresso or very strong coffee",
                  },
                ],
              },
              { kind: "ingredient", quantity: "2 large (100 g)", name: "eggs" },
            ],
          },
          { kind: "ingredient", quantity: "1/2 cup (80 g)", name: "all-purpose flour" },
          { kind: "ingredient", quantity: "1/3 cup (80 g)", name: "Hershey's cocoa powder" },
          { kind: "ingredient", quantity: "1/4 tsp. (1.3 g)", name: "baking soda" },
          { kind: "ingredient", quantity: "1/4 tsp. (1.5 g)", name: "table salt" },
        ],
      },
    ],
  },
};
