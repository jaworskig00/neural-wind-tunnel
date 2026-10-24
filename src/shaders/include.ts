/**
 * Shader include resolution.
 *
 * Three's own `ShaderChunk` mechanism only covers its built-in chunks, so this project's shared GLSL
 * lives in `src/shaders/lib` and is pulled in with `#include <name>`. The resolver is twenty lines
 * and does exactly one thing, which is better than a build plugin for a handful of chunks: the
 * shaders stay plain files that an editor highlights and a reviewer can read on GitHub.
 */

import colormap from './lib/colormap.glsl?raw'
import stations from './lib/stations.glsl?raw'

const CHUNKS: Readonly<Record<string, string>> = { colormap, stations }

const INCLUDE_PATTERN = /^[ \t]*#include <([\w-]+)>[ \t]*$/gm

/**
 * Replaces every `#include <name>` with its chunk. Includes are resolved once, not recursively: a
 * chunk that includes another would be a sign the chunks need splitting differently.
 */
export function resolveIncludes(source: string): string {
  return source.replace(INCLUDE_PATTERN, (_match, name: string) => {
    const chunk = CHUNKS[name]
    if (chunk === undefined) {
      throw new Error(
        `Unknown shader chunk "${name}". Available: ${Object.keys(CHUNKS).sort().join(', ')}`,
      )
    }
    return chunk
  })
}

export const SHADER_CHUNK_NAMES = Object.keys(CHUNKS).sort()
