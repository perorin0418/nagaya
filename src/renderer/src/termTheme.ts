/** 端末（xterm.js）の色。メインのウィンドウと別ウィンドウで同じものを使う */
import type { ITheme } from '@xterm/xterm'

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#2c2c2a',
  cursor: '#2c2c2a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(55,138,221,.30)',
}
const DARK: ITheme = {
  background: '#1a1a19',
  foreground: '#e8e6df',
  cursor: '#e8e6df',
  cursorAccent: '#1a1a19',
  selectionBackground: 'rgba(55,138,221,.40)',
}
export const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
export const termTheme = (): ITheme => (darkQuery.matches ? DARK : LIGHT)
