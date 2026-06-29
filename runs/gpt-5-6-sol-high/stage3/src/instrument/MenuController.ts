export interface MenuSnapshot { open: boolean; page: string; pageIndex: number; editing: boolean; draft: number | null; returnFocus: string | null }
export class MenuController {
  private isOpen = false
  private pageIndex = 0
  private editing = false
  private original: number | null = null
  private draft: number | null = null
  private returnFocus: string | null = null
  constructor(private readonly pages: string[]) { if (!pages.length) throw new Error('Menu needs at least one page') }
  open(returnFocus: string) { this.isOpen = true; this.returnFocus = returnFocus }
  next() { this.pageIndex = (this.pageIndex + 1) % this.pages.length }
  previous() { this.pageIndex = (this.pageIndex - 1 + this.pages.length) % this.pages.length }
  beginEdit(value: number) { this.editing = true; this.original = value; this.draft = value }
  setDraft(value: number) { if (this.editing) this.draft = value }
  confirm() { const value = this.draft; this.editing = false; this.original = null; return value }
  cancel() { const value = this.original; this.editing = false; this.original = null; this.draft = value; return value }
  close() { const target = this.returnFocus; this.isOpen = false; this.editing = false; this.returnFocus = null; return target }
  snapshot(): MenuSnapshot { return { open: this.isOpen, page: this.pages[this.pageIndex], pageIndex: this.pageIndex, editing: this.editing, draft: this.draft, returnFocus: this.returnFocus } }
}
