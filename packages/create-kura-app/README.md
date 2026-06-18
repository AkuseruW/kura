# create-kura-app

Create a new Kura application.

```sh
bun create kura-app my-app
```

After publishing, the generated app installs the Kura runtime under the local
`kura` alias, so application code imports from `"kura"`.

```sh
import { Router } from "kura";
```
