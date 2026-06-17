# @akuseru_w/create-kura

Create a new Kura application.

```sh
bunx @akuseru_w/create-kura my-app
```

After publishing, the generated app installs the Kura runtime under the local
`kura` alias, so application code imports from `"kura"`.

```sh
import { Router } from "kura";
```
