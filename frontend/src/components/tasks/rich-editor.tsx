"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function RichEditor({
  value, onChange, placeholder = "Añade una descripción…", editable = true, autofocus, className, minimal,
}: {
  value: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  className?: string;
  minimal?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    autofocus: autofocus ? "end" : false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: !editable, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: { attributes: { class: "prose-orbita focus:outline-none" } },
    onUpdate: ({ editor }) => onChange?.(editor.isEmpty ? "" : editor.getHTML()),
  });

  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML()) editor.commands.setContent(value || "", false);
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return <div className={cn("min-h-[96px]", className)} />;

  const btn = (active: boolean, onClick: () => void, Icon: typeof Bold, label: string) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn("rounded-md p-1.5 text-ink-2 hover:bg-subtle hover:text-ink", active && "bg-subtle text-ink")}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className={className}>
      {editable && !minimal && (
        <div className="mb-2 flex flex-wrap items-center gap-0.5 border-b border-line pb-2">
          {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), Bold, "Negrita")}
          {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), Italic, "Cursiva")}
          {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), Strikethrough, "Tachado")}
          {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2, "Título")}
          <span className="mx-1 h-4 w-px bg-line" />
          {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), List, "Lista")}
          {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, "Lista numerada")}
          {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), Quote, "Cita")}
          {btn(editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), Code, "Código")}
          {btn(editor.isActive("link"), () => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("URL del enlace", prev ?? "https://");
            if (url === null) return;
            if (!url) editor.chain().focus().unsetLink().run();
            else if (/^(https?:|mailto:)/.test(url)) editor.chain().focus().setLink({ href: url }).run();
          }, Link2, "Enlace")}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
