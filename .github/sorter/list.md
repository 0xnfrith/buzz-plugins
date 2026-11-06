# The sensitive list

A pull request that touches any area below waits for the owner's approval of its latest commit. The AI sorter reads this file and puts it
in the model's instructions, word for word. `always.txt` names the paths that count as touching it without asking the model.

1. **CI and repository rules**: workflows, CI configuration, CODEOWNERS, branch, merge and review rules, and this sorter itself.
2. **Credentials and secret handling**: API keys, tokens, passwords and signing keys, and code that asks for, stores, reads, sends or
   logs any of them.
3. **Payments and billing**: prices, charges, checkout, subscriptions, invoices and refunds.
4. **Legal and licensing text**: license files and license headers, terms, privacy wording and other legal statements.
5. **Deleting user data**: code that deletes, wipes or overwrites a user's data, accounts or settings.
6. **Release and publishing settings**: how and where the project is versioned, released, published or distributed, and what tells an
   installed copy that an update exists.
