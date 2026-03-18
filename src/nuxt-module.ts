import { defineNuxtModule, addVitePlugin } from '@nuxt/kit';
import type { Nuxt } from '@nuxt/schema';
import { aiAnnotator, type AiAnnotatorOptions } from './vite-plugin';

export interface NuxtAiAnnotatorOptions extends AiAnnotatorOptions {}

export default defineNuxtModule<NuxtAiAnnotatorOptions>({
  meta: {
    name: 'vite-plugin-ai-annotator',
    configKey: 'aiAnnotator',
    compatibility: {
      nuxt: '^4.0.0',
    },
  },
  defaults: {
    port: 7318,
    listenAddress: '127.0.0.1',
    verbose: false,
    injectSourceLoc: true,
  },
  setup(options: NuxtAiAnnotatorOptions, nuxt: Nuxt) {
    // Only enable in development mode
    if (!nuxt.options.dev) {
      return;
    }

    // Add Vite plugin
    addVitePlugin(aiAnnotator(options));

    console.log('[ai-annotator] Nuxt module initialized');
  },
});
