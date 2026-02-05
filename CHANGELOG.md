# Changelog

## [1.2.0](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/compare/v1.1.0...v1.2.0) (2026-02-05)


### Features

* **detector:** add Nuxt support via data-v-inspector fallback ([0292056](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/0292056b9841a9deb8bdc47e370e63774b6d6c47))
* **mcp:** add fields parameter to annotator_get_feedback tool ([6f79a4d](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/6f79a4d1031d4710ab90eb8b5c970bf0636f68a9))
* **plugin:** add autoSetupMcp option for automatic MCP configuration ([886eb17](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/886eb170654ee295208a04e51f365d06cb5396ef))
* **screenshot:** always use webp format for smaller file size ([2dcdf73](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/2dcdf733a91dc959606b41144af0482933b351f5))
* **toolbar:** add drag-to-select multiple elements ([2b1e5f4](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/2b1e5f4dae7c74882645d64fd459e90c64d202bb))
* **toolbar:** add text selection annotation support ([588eac3](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/588eac383c58297d54bf86e31b3aac7f965fa158))
* **toolbar:** add tooltip and refactor selection handling ([ba62c1d](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/ba62c1da4eaa4f8338a32c6facbc19eafb2a76c7))
* **toolbar:** auto-resize textarea and update feedback terminology ([62d1760](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/62d176093a86d9c4a2e5983bc88d194fb758db4a))
* **toolbar:** close comment popover on click outside ([e27e335](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/e27e335664db85e05487f7ec8a5b817bf23774cd))
* **toolbar:** smart multi-select using LCA algorithm ([9fad99a](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/9fad99a890ffa65d4d99565b7b9a3c393bcb7bfa))
* **toolbar:** smarter container detection for drag-select ([c5f05c7](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/c5f05c753470ac124360a7357a26198cf48740c5))
* **ui:** cyberpunk terminal-style redesign ([28e2ae5](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/28e2ae5a1e36a630a55992d88622ad693ee89501))


### Bug Fixes

* improve MCP auto-setup feedback and screenshot quality ([b48d3a7](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/b48d3a72592397f24063b02b1dba36726581441b))
* **inspection:** remove annotator-ignore from hover overlay to allow selection ([152110a](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/152110aff910fc5e10c1c8d355c0f6a1a52da66f))
* **inspection:** restore text selection support in inspect mode ([fb90ea2](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/fb90ea27fbd694c4135e6df55c334de802d6a624))
* **mcp:** create default .mcp.json when no configs detected ([ce3e163](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/ce3e163cb4712ffc7a0c1f183b14c6f2f4a4a608))
* **mcp:** detect existing configs before auto-setup ([987a890](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/987a89030a29d861ff1c93f0462204b7e3c55c9f))
* **mcp:** move componentData to basic fields, xpath to optional ([3102a2d](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/3102a2db3360079e38b4bca2514cae0e01644288))
* **mcp:** require selector for screenshot tool ([26f8d42](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/26f8d42039d5945a1172e860919e39c92f53654d))
* **selection:** fix text selection not being selected after wrap ([2b24e79](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/2b24e79fc4b4b9b10a1d6fb84323a7a91f0024ac))
* **selection:** optimize autoUpdate by merging badge and overlay into SelectionGroup ([caa4316](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/caa4316415807f8c0c949e78d7a0da5790c3f261))
* **selection:** overlay handles click events for selected elements ([30754e3](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/30754e383e030fb19732e380542390c262ac90f0))
* **server:** default listenAddress to 127.0.0.1 for security ([afd92de](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/afd92de26e8bfebe89e846c8e8d678b04824ba14))
* **server:** increase Socket.IO max buffer size to 50MB ([bdc995e](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/bdc995e2796f06043a4b79f7252aeb412400ce63))
* **server:** remove race condition in stopServer shutdown ([7533bcb](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/7533bcb7fde7cbbc3e3278cc22f7f8a4ef9a8e32))
* **toolbar:** add border for visibility on dark backgrounds ([bbd5ffa](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/bbd5ffacfbaaff17e76c60657d642de3586c32c1))
* **toolbar:** change badge label format from (N) [name] to #N name ([794251b](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/794251b86fe0f4a8574dc18406fef2042df191fe))
* **toolbar:** clean up orphaned wrapper on selectElement failure ([2bdabaf](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/2bdabafbbdd20ba1c1fa39c680c6bd5059d03677))
* **toolbar:** clear selection now properly removes all outlines ([8431101](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/8431101f94558fd8809c71f6ad62abf30b6ea24f))
* **toolbar:** copy text mentions annotator_get_selected_elements tool ([3645394](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/3645394207e1bb953e0ed0df1e373be92de9ea5a))
* **toolbar:** disable text selection during inspection mode ([377627e](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/377627eb62f536fe64a2e3b0bf9ddff5cc0a752d))
* **toolbar:** fix popover layout - buttons below textarea instead of overlapping ([fbe5930](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/fbe5930a51c28eeed938e908f5c0351291bb2723))
* **toolbar:** improve hover highlight with purple marching ants and border radius ([9f9ac52](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/9f9ac52cfae04371d7855aa549e04b399bdeb824))
* **toolbar:** improve screenshot capture by selector reliability ([3a93b27](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/3a93b2790511253f5b64cb6112a5693c9e5eb386))
* **toolbar:** include session ID in copy and exit inspect mode after copy ([d26288b](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/d26288b745f15ba4b570c0ad47c245f65e8d5af8))
* **toolbar:** include session ID in copy text ([0c658a9](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/0c658a9d256621740f950945221f268541b88318))
* **toolbar:** increase popover button icon size from 12px to 14px ([c06dafe](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/c06dafe4758246c4bc652ab283a8c59b5d5358e7))
* **toolbar:** increase popover button to 32px and icon to 18px ([1cb5ac9](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/1cb5ac925d62d60f069b76edd28666d978b60eca))
* **toolbar:** only show console logs when verbose=true ([99d93c3](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/99d93c3db1e03a12005d995da5a203727bf47f55))
* **toolbar:** popover layout and outline clearing bug ([b49b780](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/b49b780c0f405b9bc80cff11e2e587f2b303096e))
* **toolbar:** position popover relative to badge for better placement ([4879da7](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/4879da77a110f76180c29487c28825730b2cf5cb))
* **toolbar:** position popover relative to badge to prevent overlap ([da5abdb](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/da5abdbec40950ab6113f867c94c41714e3e8b63))
* **toolbar:** prevent click event after drag selection ([3b76a50](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/3b76a50ecc3916fa0f0ed4a32103a748839a5693))
* **toolbar:** reduce badge size for less visual footprint ([bf947d1](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/bf947d13c079a88768823fe15568d95da5892294))
* **toolbar:** remove popover label that caused badge overlap ([6cd47bf](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/6cd47bfb034e8a273104f69b327d968d4950be17))
* **toolbar:** remove textarea min-height buffer ([786188e](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/786188e0d300c3b997963102e4e813074481b810))
* **toolbar:** update copy button to mention annotator_get_selected_elements ([83f8446](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/83f8446868901640e3388530576241d5ee858e9b))
* **toolbar:** update help button URL to annotator.aiocean.io ([d43e7e9](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/d43e7e965dc26b28786c6136bca9944c0a957c0a))
* **toolbar:** update textarea auto-resize max to 120px ([d2d531f](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/d2d531fd96de2e4cb1dd56bab062c497cfffb1d4))
* **toolbar:** use virtual reference for popover positioning ([191faea](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/191faea1f11938ac51d197092f2b9b318d18b27d))
* **ui:** add background to popover label for visibility ([fa56732](https://github.com/nguyenvanduocit/vite-plugin-ai-annotator/commit/fa5673235c3a5ba28c9c73931c16caa32809023b))

## [1.2.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.1.0...v1.2.0) (2025-12-26)


### Features

* **inspector:** add active tools section for real-time tool feedback ([bbfc668](https://github.com/nguyenvanduocit/instantCode/commit/bbfc668aee66413d24b513696e6c97843153aead))

## [1.1.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.0.0...v1.1.0) (2025-09-23)


### Features

* **inspector:** add copy button to individual messages ([7b24f29](https://github.com/nguyenvanduocit/instantCode/commit/7b24f298b0328b2fc5a69c79cd18ec06e964b759))
* **inspector:** add copy button to toolbar for prompt data ([183c7ff](https://github.com/nguyenvanduocit/instantCode/commit/183c7fffa2a6b390368807471394cda25ac7690e))

## 1.0.0 (2025-09-19)


### Features

* **build:** add TypeScript declaration file generation ([b01a770](https://github.com/nguyenvanduocit/instantCode/commit/b01a770e87dea4f7cb244868badbba418d521c52))
* **config:** add configurable listen and public addresses ([c5143b6](https://github.com/nguyenvanduocit/instantCode/commit/c5143b64dcee2bcb715d00807255929dac3b26b0))
* improve ([ac53c4e](https://github.com/nguyenvanduocit/instantCode/commit/ac53c4e686d79c0d067391ea2e4a701d1ce220a3))
* **inspector:** add imagePaths parameter to buildHierarchicalStructure ([6099a2a](https://github.com/nguyenvanduocit/instantCode/commit/6099a2a0329dcd13b828fd364bdefa05eb2bd220))
* **inspector:** add mock mode support and enhance message display ([20f7d85](https://github.com/nguyenvanduocit/instantCode/commit/20f7d85de11bcc6c3cf2720ce5dae252546b3560))
* **inspector:** add screenshot capture of selected elements ([a2317d9](https://github.com/nguyenvanduocit/instantCode/commit/a2317d95bc13e5f2cd755cf4f9348f4c252f3cf3))
* **inspector:** enhance component detection with React support and source mapping ([0fbaead](https://github.com/nguyenvanduocit/instantCode/commit/0fbaead749431f171a0c24ad9be9e2d36b9c8c1b))
* **inspector:** improve processing state management and message handling ([87162eb](https://github.com/nguyenvanduocit/instantCode/commit/87162eb195826542164039fac2585d4d15d38387))
* **inspector:** improve screenshot filename format with element metadata ([fe94ea7](https://github.com/nguyenvanduocit/instantCode/commit/fe94ea7a6892511616d2ae397416528b7d846782))
* **inspector:** integrate imagePath field with client and server ([494bdf6](https://github.com/nguyenvanduocit/instantCode/commit/494bdf61771686e327b4f71aa6ab45a78c71e53e))
* **inspector:** switch from PNG to JPEG for smaller file sizes ([36dc5d7](https://github.com/nguyenvanduocit/instantCode/commit/36dc5d77b729ae7bee0a64be2a3f4045a95a584f))
* **inspector:** switch from PNG to WebP for element screenshots ([d5f978d](https://github.com/nguyenvanduocit/instantCode/commit/d5f978d42462b49ae19e62b059b90c6be6ecb9c9))
* **inspector:** switch from WebP to JPEG for element screenshots ([3a4b5dd](https://github.com/nguyenvanduocit/instantCode/commit/3a4b5dd0c93c8b670242d4c9497d7d85abacb63c))
* **inspector:** upgrade to modern Navigation API for navigation prevention ([43980e2](https://github.com/nguyenvanduocit/instantCode/commit/43980e271ec9f5e9ed43b6ec5857210b2bedc46c))
* **inspector:** upgrade to modern Navigation API for navigation prevention ([85ddbab](https://github.com/nguyenvanduocit/instantCode/commit/85ddbabd7159da1d5634e2eaa1fb700b85707d6a))
* **inspector:** upgrade to modern Navigation API for navigation prevention ([f9cd403](https://github.com/nguyenvanduocit/instantCode/commit/f9cd403e26e1437e2f175a773b1fed481634f5fa))
* **schemas:** add computed styles to ElementDataSchema ([a6feae3](https://github.com/nguyenvanduocit/instantCode/commit/a6feae3b54392d7eca36631c981610bb87461c13))
* **schemas:** add imagePath parameter to buildHierarchicalStructure ([cea1a66](https://github.com/nguyenvanduocit/instantCode/commit/cea1a666b5ba404cf02f88b7e5f3051763d9f28c))
* **schemas:** add imagePath to ElementDataSchema ([8452bcf](https://github.com/nguyenvanduocit/instantCode/commit/8452bcfc1743979075a2fc86d92f877d58bc80e0))
* **server:** add configurable listen and public addresses ([af65f9b](https://github.com/nguyenvanduocit/instantCode/commit/af65f9bd5530a9c88b2224343f3285913de0d886))
* **server:** add POST endpoint for base64 image upload ([b4c88a5](https://github.com/nguyenvanduocit/instantCode/commit/b4c88a516782685770fa6b7305e8a1f216bb5f0c))
* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))
* **vite:** add Vite plugin for seamless development integration ([b0ad1e5](https://github.com/nguyenvanduocit/instantCode/commit/b0ad1e5d0cde5a1d081918a6c647a177b846e39e))
* **vite:** restrict plugin to development mode only ([cb5af6b](https://github.com/nguyenvanduocit/instantCode/commit/cb5af6bacc29352ec07f4080975d43f4034fac58))


### Bug Fixes

* **docs:** correct markdown syntax in plugin config ([619381a](https://github.com/nguyenvanduocit/instantCode/commit/619381a3224fc603b13a35cdc382600fe9d6df1f))
* **inspector:** exit inspect mode when closing card with toggle ([79e548c](https://github.com/nguyenvanduocit/instantCode/commit/79e548c4a7a505eb8ea72e34be89f9e1febd7a9c))
* **inspector:** exit inspect mode when closing card with toggle ([cdcd7c1](https://github.com/nguyenvanduocit/instantCode/commit/cdcd7c17b9bf1b5ccc175f75dffcf81728d06854))
* **inspector:** remove message deduplication causing init message to disappear ([7c89360](https://github.com/nguyenvanduocit/instantCode/commit/7c8936029efee3d0385e7821e2d435d1c6dd7438))
* **inspector:** revert to PNG for transparent background support ([26152b8](https://github.com/nguyenvanduocit/instantCode/commit/26152b8f076c69878d09476b11244ea64f34b981))
* **inspector:** revert to PNG for transparent background support ([a55c351](https://github.com/nguyenvanduocit/instantCode/commit/a55c351907fd82ad02d1437a658c42d60cbfa53f))
* **inspector:** send full file path for image uploads ([395762f](https://github.com/nguyenvanduocit/instantCode/commit/395762f243da08460bd863e38a454a87e08f2ca2))
* **server:** accept full file path in upload-image endpoint ([2341006](https://github.com/nguyenvanduocit/instantCode/commit/234100671f839c8e8854385f63bd49db3e409b62))
* **server:** improve return statement in upload-image endpoint ([4d0d1d7](https://github.com/nguyenvanduocit/instantCode/commit/4d0d1d765bf71e1410f4ef3b10cd515dba680801))
* **server:** simplify public address handling ([05450ee](https://github.com/nguyenvanduocit/instantCode/commit/05450eebb4b477015acc564a7fd971071261c237))

## [1.12.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.11.0...v1.12.0) (2025-09-10)


### Features

* **build:** add TypeScript declaration file generation ([2d49d0e](https://github.com/nguyenvanduocit/instantCode/commit/2d49d0e58a6938dab604980d299720596fe87c98))
* **config:** add configurable listen and public addresses ([49d8a25](https://github.com/nguyenvanduocit/instantCode/commit/49d8a2533237494d29394268867243bddf52af4f))
* improve ([1b8c6b6](https://github.com/nguyenvanduocit/instantCode/commit/1b8c6b6006aee586f430c020aaaafab032a96798))
* **inspector:** add imagePaths parameter to buildHierarchicalStructure ([3798c5f](https://github.com/nguyenvanduocit/instantCode/commit/3798c5f7307b1b4b123d843e4e5b3e228a5f33cf))
* **inspector:** add mock mode support and enhance message display ([0450da5](https://github.com/nguyenvanduocit/instantCode/commit/0450da598254ebec9db810e6cf4aefd7a07a9cb9))
* **inspector:** add screenshot capture of selected elements ([7c5d8d9](https://github.com/nguyenvanduocit/instantCode/commit/7c5d8d90e1b015ba0a7e8461cc3ee0f8eddaedcd))
* **inspector:** enhance component detection with React support and source mapping ([7cf34f9](https://github.com/nguyenvanduocit/instantCode/commit/7cf34f9e75f9c2cfd01eac5ea4a0a71fddb520ca))
* **inspector:** improve processing state management and message handling ([5586f7b](https://github.com/nguyenvanduocit/instantCode/commit/5586f7ba03285c85fdbec118bd246d0c1a4f924a))
* **inspector:** improve screenshot filename format with element metadata ([baeceff](https://github.com/nguyenvanduocit/instantCode/commit/baeceff29ea535a449dc84a5e91c5c592d2adaa3))
* **inspector:** integrate imagePath field with client and server ([9f9e098](https://github.com/nguyenvanduocit/instantCode/commit/9f9e09826163d4489bec1e70af0a6bea125ec742))
* **inspector:** switch from PNG to JPEG for smaller file sizes ([39f8557](https://github.com/nguyenvanduocit/instantCode/commit/39f855777f50cb8a0a3d23ef0106dade89bf01ef))
* **inspector:** switch from PNG to WebP for element screenshots ([b63c9f9](https://github.com/nguyenvanduocit/instantCode/commit/b63c9f98064418b22448e6868318a247bbaf5260))
* **inspector:** switch from WebP to JPEG for element screenshots ([64999a1](https://github.com/nguyenvanduocit/instantCode/commit/64999a10b3f50a37fd77e322ba194b04ab4fa79c))
* **schemas:** add computed styles to ElementDataSchema ([e6bc7a9](https://github.com/nguyenvanduocit/instantCode/commit/e6bc7a908a2c4385b90175e7dcf276060f618237))
* **schemas:** add imagePath parameter to buildHierarchicalStructure ([93f38c9](https://github.com/nguyenvanduocit/instantCode/commit/93f38c9bea7c5da055e694fc88b1c925ae182c14))
* **schemas:** add imagePath to ElementDataSchema ([7c95f73](https://github.com/nguyenvanduocit/instantCode/commit/7c95f73cddf0582e1f2353a37b02653bff31a6d3))
* **server:** add configurable listen and public addresses ([6c13e3c](https://github.com/nguyenvanduocit/instantCode/commit/6c13e3c8d78613b0b94ab99a0b1f39091b85770b))
* **server:** add POST endpoint for base64 image upload ([e0baafd](https://github.com/nguyenvanduocit/instantCode/commit/e0baafd0ed69ad20bc1749ef0b5d741fedaad5f0))
* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))
* **vite:** add Vite plugin for seamless development integration ([b1d86fc](https://github.com/nguyenvanduocit/instantCode/commit/b1d86fcf88815a999adda5f87549726b4a254f63))
* **vite:** restrict plugin to development mode only ([c006dae](https://github.com/nguyenvanduocit/instantCode/commit/c006dae7969ece2e778a22f967b33a4c1ad3dff0))


### Bug Fixes

* **inspector:** exit inspect mode when closing card with toggle ([78d18b4](https://github.com/nguyenvanduocit/instantCode/commit/78d18b4468607135eb63aad03b19e291a64aeaae))
* **inspector:** exit inspect mode when closing card with toggle ([7012fc7](https://github.com/nguyenvanduocit/instantCode/commit/7012fc7dc9123272436d091477074c7eff6f3544))
* **inspector:** remove message deduplication causing init message to disappear ([3705fb0](https://github.com/nguyenvanduocit/instantCode/commit/3705fb0ee412b420261f5b9ece8e463e866050e4))
* **inspector:** revert to PNG for transparent background support ([962d653](https://github.com/nguyenvanduocit/instantCode/commit/962d653e747638a9a2b9b7a2be5f63e28fcf17ec))
* **inspector:** revert to PNG for transparent background support ([6275fb5](https://github.com/nguyenvanduocit/instantCode/commit/6275fb5e1651caf20c9853920c72d6da074cf0da))
* **inspector:** send full file path for image uploads ([d93e6a6](https://github.com/nguyenvanduocit/instantCode/commit/d93e6a6d4455724ff574f78612273a2f5c79d2d8))
* **server:** accept full file path in upload-image endpoint ([35ee512](https://github.com/nguyenvanduocit/instantCode/commit/35ee512210f8befc482c2ae2c96cbfc648947128))
* **server:** improve return statement in upload-image endpoint ([a8b8738](https://github.com/nguyenvanduocit/instantCode/commit/a8b87387df10121679bec4b69b4a9b7fab2c0078))
* **server:** simplify public address handling ([37e7581](https://github.com/nguyenvanduocit/instantCode/commit/37e75813334fd2d57cf26cd3a037e38166c2b28d))

## [1.11.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.10.0...v1.11.0) (2025-09-10)


### Features

* **inspector:** add imagePaths parameter to buildHierarchicalStructure ([3798c5f](https://github.com/nguyenvanduocit/instantCode/commit/3798c5f7307b1b4b123d843e4e5b3e228a5f33cf))
* **inspector:** add screenshot capture of selected elements ([7c5d8d9](https://github.com/nguyenvanduocit/instantCode/commit/7c5d8d90e1b015ba0a7e8461cc3ee0f8eddaedcd))
* **inspector:** improve screenshot filename format with element metadata ([baeceff](https://github.com/nguyenvanduocit/instantCode/commit/baeceff29ea535a449dc84a5e91c5c592d2adaa3))
* **inspector:** integrate imagePath field with client and server ([9f9e098](https://github.com/nguyenvanduocit/instantCode/commit/9f9e09826163d4489bec1e70af0a6bea125ec742))
* **schemas:** add computed styles to ElementDataSchema ([e6bc7a9](https://github.com/nguyenvanduocit/instantCode/commit/e6bc7a908a2c4385b90175e7dcf276060f618237))
* **schemas:** add imagePath parameter to buildHierarchicalStructure ([93f38c9](https://github.com/nguyenvanduocit/instantCode/commit/93f38c9bea7c5da055e694fc88b1c925ae182c14))
* **schemas:** add imagePath to ElementDataSchema ([7c95f73](https://github.com/nguyenvanduocit/instantCode/commit/7c95f73cddf0582e1f2353a37b02653bff31a6d3))
* **server:** add POST endpoint for base64 image upload ([e0baafd](https://github.com/nguyenvanduocit/instantCode/commit/e0baafd0ed69ad20bc1749ef0b5d741fedaad5f0))


### Bug Fixes

* **inspector:** send full file path for image uploads ([d93e6a6](https://github.com/nguyenvanduocit/instantCode/commit/d93e6a6d4455724ff574f78612273a2f5c79d2d8))
* **server:** accept full file path in upload-image endpoint ([35ee512](https://github.com/nguyenvanduocit/instantCode/commit/35ee512210f8befc482c2ae2c96cbfc648947128))
* **server:** improve return statement in upload-image endpoint ([a8b8738](https://github.com/nguyenvanduocit/instantCode/commit/a8b87387df10121679bec4b69b4a9b7fab2c0078))
* **server:** simplify public address handling ([37e7581](https://github.com/nguyenvanduocit/instantCode/commit/37e75813334fd2d57cf26cd3a037e38166c2b28d))

## [1.10.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.9.2...v1.10.0) (2025-08-27)


### Features

* **config:** add configurable listen and public addresses ([49d8a25](https://github.com/nguyenvanduocit/instantCode/commit/49d8a2533237494d29394268867243bddf52af4f))
* **server:** add configurable listen and public addresses ([6c13e3c](https://github.com/nguyenvanduocit/instantCode/commit/6c13e3c8d78613b0b94ab99a0b1f39091b85770b))

## [1.9.2](https://github.com/nguyenvanduocit/instantCode/compare/v1.9.1...v1.9.2) (2025-08-20)


### Bug Fixes

* **inspector:** exit inspect mode when closing card with toggle ([78d18b4](https://github.com/nguyenvanduocit/instantCode/commit/78d18b4468607135eb63aad03b19e291a64aeaae))
* **inspector:** exit inspect mode when closing card with toggle ([7012fc7](https://github.com/nguyenvanduocit/instantCode/commit/7012fc7dc9123272436d091477074c7eff6f3544))

## [1.9.1](https://github.com/nguyenvanduocit/instantCode/compare/v1.9.0...v1.9.1) (2025-08-20)


### Bug Fixes

* **inspector:** remove message deduplication causing init message to disappear ([3705fb0](https://github.com/nguyenvanduocit/instantCode/commit/3705fb0ee412b420261f5b9ece8e463e866050e4))

## [1.9.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.8.0...v1.9.0) (2025-08-19)


### Features

* **inspector:** enhance component detection with React support and source mapping ([7cf34f9](https://github.com/nguyenvanduocit/instantCode/commit/7cf34f9e75f9c2cfd01eac5ea4a0a71fddb520ca))

## [1.8.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.7.0...v1.8.0) (2025-08-19)


### Features

* **inspector:** add mock mode support and enhance message display ([0450da5](https://github.com/nguyenvanduocit/instantCode/commit/0450da598254ebec9db810e6cf4aefd7a07a9cb9))

## [1.7.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.6.0...v1.7.0) (2025-08-19)


### Features

* **vite:** restrict plugin to development mode only ([c006dae](https://github.com/nguyenvanduocit/instantCode/commit/c006dae7969ece2e778a22f967b33a4c1ad3dff0))

## [1.6.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.5.0...v1.6.0) (2025-08-19)


### Features

* **build:** add TypeScript declaration file generation ([2d49d0e](https://github.com/nguyenvanduocit/instantCode/commit/2d49d0e58a6938dab604980d299720596fe87c98))

## [1.5.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.4.0...v1.5.0) (2025-08-19)


### Features

* **vite:** add Vite plugin for seamless development integration ([b1d86fc](https://github.com/nguyenvanduocit/instantCode/commit/b1d86fcf88815a999adda5f87549726b4a254f63))

## [1.4.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.3.0...v1.4.0) (2025-08-18)


### Features

* **inspector:** improve processing state management and message handling ([5586f7b](https://github.com/nguyenvanduocit/instantCode/commit/5586f7ba03285c85fdbec118bd246d0c1a4f924a))

## [1.3.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.2.0...v1.3.0) (2025-08-18)


### Features

* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))

## [1.2.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.1.0...v1.2.0) (2025-08-18)


### Features

* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))

## [1.1.0](https://github.com/nguyenvanduocit/instantCode/compare/v1.0.0...v1.1.0) (2025-08-18)


### Features

* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))

## 1.0.0 (2025-08-18)


### Features

* simplify CI/CD with release-please automation ([bd798c0](https://github.com/nguyenvanduocit/instantCode/commit/bd798c096f3e581ede1f48940a5a019c90dca5be))
