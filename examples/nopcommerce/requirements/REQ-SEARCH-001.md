# REQ-SEARCH-001: Product catalogue search

## Business requirement

A customer shall be able to search the nopCommerce catalogue using complete or partial product-name keywords and view relevant matching products.

## Acceptance criteria

### AC-SEARCH-001

Searching for the complete term "Build your own computer" displays the product "Build your own computer".

### AC-SEARCH-002

Searching for the partial term "computer" displays at least one relevant result and includes "Build your own computer".

### AC-SEARCH-003

Search execution opens the search-results experience without an application error.

## Important observed behaviour

Manual testing established that searching for "computer" currently displays one result:

> Build your own computer

The automated test does not assert that the result count equals one because the shared public catalogue may change.

Invalid-search validation is outside this milestone because its exact wording has not yet been manually confirmed.
