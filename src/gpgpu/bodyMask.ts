/**
 * A one-bit picture of where the section is, in field coordinates.
 *
 * The particle step needs to know whether a position is inside the body. Testing a polygon
 * analytically in the shader would mean 160 edge tests per particle per frame; rasterising the same
 * polygon once into a small target costs 160 triangles, and the test becomes a texture fetch.
 *
 * Rebuilt whenever the shape changes, which during a slider drag is every frame -- and still
 * negligible, because it is 160 triangles into a target smaller than an icon.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import { sectionLoop } from '../geometry/cst'
import type { Section } from '../geometry/shapeOps'
import { FIELD_HEIGHT, FIELD_WIDTH, FIELD_X_RANGE, FIELD_Y_RANGE } from '../rom/podAtlas'

/** Mask resolution. Twice the field grid, so the body edge is not quantised to a field texel. */
const MASK_WIDTH = FIELD_WIDTH * 2
const MASK_HEIGHT = FIELD_HEIGHT * 2

export class BodyMask {
  private readonly target: WebGLRenderTarget
  private readonly scene = new Scene()
  private readonly camera: OrthographicCamera
  private readonly material = new MeshBasicMaterial({ color: 0xffffff })
  private geometry = new BufferGeometry()
  private mesh: Mesh

  constructor() {
    this.target = new WebGLRenderTarget(MASK_WIDTH, MASK_HEIGHT, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    })
    // An orthographic camera spanning exactly the field domain, so a mask texel and a field texel
    // describe the same place.
    this.camera = new OrthographicCamera(
      FIELD_X_RANGE[0],
      FIELD_X_RANGE[1],
      FIELD_Y_RANGE[1],
      FIELD_Y_RANGE[0],
      0,
      1,
    )
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  get texture() {
    return this.target.texture
  }

  /** Rebuilds the mask for a section. */
  update(renderer: WebGLRenderer, section: Section): void {
    const loop = sectionLoop(section.upper, section.lower, 160)
    const points = loop.slice(0, -1)

    // A triangle fan from the mid-chord point, which lies inside every section the validity filters
    // let through, so the fan covers the body exactly.
    const positions = new Float32Array((points.length + 1) * 3)
    positions[0] = 0.5
    positions[1] = 0
    positions[2] = 0
    points.forEach((point, index) => {
      positions[(index + 1) * 3] = point.x
      positions[(index + 1) * 3 + 1] = point.z
      positions[(index + 1) * 3 + 2] = 0
    })

    const indices: number[] = []
    for (let i = 0; i < points.length; i += 1) {
      indices.push(0, i + 1, ((i + 1) % points.length) + 1)
    }

    this.geometry.dispose()
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3))
    this.geometry.setIndex(indices)
    this.mesh.geometry = this.geometry

    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear(true, false, false)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(previous)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.target.dispose()
  }
}
