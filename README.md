# eta.-WHACK

## Tasks to be completed:
- Research Asteroids and create dataset of quantity of resources available in different asteroids
- Research current space travel and estimate the ability of future space rockets (how much distance can they travel, how long will they last with certain resources, which ones can they gain from space, etc)
- Research space mining and how much resource output we'll be able to gain from the mining AND what we can use those resources for
- After research, we should know how many resources we can get from each asteroid, how much it costs to maintain the mining and how much it costs to travel to each asteroid.
- Refine project specification and determine which functionality is essential/an extension/etc
- Design/implement algorithms to be used in the program including the algorithm to determine which asteroids to mine, which path to take and what our estimated gains/costs are in terms of money and resources
- Design the space simulation and how we will represent the different asteroids and planets.
- Design the UI of the program/Logo
- Create presentation

## Running the app

The station planner (weighted k-means + Monte Carlo) runs in Python; the UI only calls it and draws the result.

```sh
pip install -r requirements.txt
uvicorn asteroid_industry.api:app --port 8000   # from the repo root

cd "UI Skeleton" && pnpm install && pnpm dev     # proxies /api/planner/* to the planner
```

Set `PLANNER_URL` for the UI if the planner runs somewhere other than `http://127.0.0.1:8000`.
After changing either DAG, regenerate the product model with `python tools/build_product_supply_data.py`.
