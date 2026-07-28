"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  saveCatalogMessage,
  type CatalogMessageActionState,
} from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/admin/ui";

export type MessageCategoryOption = {
  key: string;
  name: string;
};

export type EditableCatalogMessage = {
  id?: string;
  import_key?: string | null;
  title?: string | null;
  text?: string | null;
  category?: string | null;
  tone?: string | null;
  is_active?: boolean | null;
  is_explore_published?: boolean | null;
  explore_sort_order?: number | null;
  is_reserve_eligible?: boolean | null;
  reserve_default_approved?: boolean | null;
  reserve_sort_order?: number | null;
  theme_key?: string | null;
  animation_key?: string | null;
  sound_key?: string | null;
  background_key?: string | null;
  font_key?: string | null;
  text_size_key?: string | null;
  text_alignment_key?: string | null;
  text_position_key?: string | null;
};

const initialState: CatalogMessageActionState = { ok: false, error: "" };

function CheckboxField({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-[#3a1e22]/10 p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 accent-[#c9484a]"
      />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[#8d7376]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function MessageEditorForm({
  message,
  categories,
}: {
  message: EditableCatalogMessage;
  categories: MessageCategoryOption[];
}) {
  const router = useRouter();
  const initialCategory = message.category ?? categories[0]?.key ?? "__new__";
  const [category, setCategory] = useState(initialCategory);
  const [state, action, pending] = useActionState(
    saveCatalogMessage,
    initialState
  );

  useEffect(() => {
    if (state.ok) {
      toast.success(message.id ? "Message updated" : "Message created");
      if (!message.id && state.savedId) {
        router.replace(`/admin/messages?edit=${state.savedId}`);
      } else {
        router.refresh();
      }
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [message.id, router, state]);

  return (
    <form action={action} className="space-y-5">
      {message.id ? <input type="hidden" name="id" value={message.id} /> : null}

      <div>
        <label htmlFor="message-text" className="mb-2 block text-sm font-semibold">
          Message text
        </label>
        <textarea
          id="message-text"
          name="text"
          required
          maxLength={500}
          defaultValue={message.text ?? ""}
          rows={5}
          className={`${fieldClass} h-auto min-h-32 py-3 leading-6`}
          placeholder="Write something a real person would want to send…"
        />
        <p className="mt-1 text-xs text-[#8d7376]">1–500 characters</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="message-title" className="mb-2 block text-sm font-semibold">
            Internal title
          </label>
          <input
            id="message-title"
            name="title"
            maxLength={200}
            defaultValue={message.title ?? ""}
            className={fieldClass}
            placeholder="Optional admin label"
          />
        </div>
        <div>
          <label htmlFor="message-import-key" className="mb-2 block text-sm font-semibold">
            Import key
          </label>
          <input
            id="message-import-key"
            name="importKey"
            maxLength={160}
            defaultValue={message.import_key ?? ""}
            className={fieldClass}
            placeholder="Optional stable key"
          />
        </div>
        <div>
          <label htmlFor="message-category" className="mb-2 block text-sm font-semibold">
            Category
          </label>
          <select
            id="message-category"
            name="category"
            required
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={fieldClass}
          >
            {categories.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
            <option value="__new__">＋ Create a new category…</option>
          </select>
        </div>
        {category === "__new__" ? (
          <div>
            <label htmlFor="new-category-name" className="mb-2 block text-sm font-semibold">
              New category name
            </label>
            <input
              id="new-category-name"
              name="newCategoryName"
              required
              maxLength={60}
              className={fieldClass}
              placeholder="For example, Celebration"
            />
            <p className="mt-1 text-xs text-[#8d7376]">
              Saving creates this category and assigns the message to it.
            </p>
          </div>
        ) : null}
        <div>
          <label htmlFor="message-tone" className="mb-2 block text-sm font-semibold">
            Tone
          </label>
          <input
            id="message-tone"
            name="tone"
            maxLength={50}
            defaultValue={message.tone ?? ""}
            className={fieldClass}
            placeholder="warm, grounded…"
          />
        </div>
      </div>

      <div className="grid gap-3">
        <CheckboxField
          name="isActive"
          label="Active"
          description="Inactive messages are unavailable everywhere."
          defaultChecked={message.is_active !== false}
        />
        <CheckboxField
          name="isExplorePublished"
          label="Published in Explore"
          description="Senders can browse and copy this message."
          defaultChecked={message.is_explore_published === true}
        />
        <CheckboxField
          name="isReserveEligible"
          label="Reserve eligible"
          description="May be used by the automatic Reserve system."
          defaultChecked={message.is_reserve_eligible === true}
        />
        <CheckboxField
          name="reserveDefaultApproved"
          label="Default-approved for Reserve"
          description="New necklaces approve this Reserve message by default."
          defaultChecked={message.reserve_default_approved === true}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="explore-order" className="mb-2 block text-sm font-semibold">
            Explore order
          </label>
          <input
            id="explore-order"
            name="exploreSortOrder"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={message.explore_sort_order ?? 0}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="reserve-order" className="mb-2 block text-sm font-semibold">
            Reserve order
          </label>
          <input
            id="reserve-order"
            name="reserveSortOrder"
            type="number"
            min={1}
            step={1}
            defaultValue={message.reserve_sort_order ?? ""}
            className={fieldClass}
            placeholder="Optional"
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Presentation defaults</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="theme-key" className="mb-1 block text-xs text-[#765d60]">Theme</label>
            <input id="theme-key" name="themeKey" defaultValue={message.theme_key ?? "heart"} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="animation-key" className="mb-1 block text-xs text-[#765d60]">Animation</label>
            <input id="animation-key" name="animationKey" defaultValue={message.animation_key ?? "breathe"} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="sound-key" className="mb-1 block text-xs text-[#765d60]">Sound</label>
            <input id="sound-key" name="soundKey" defaultValue={message.sound_key ?? "soft"} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="background-key" className="mb-1 block text-xs text-[#765d60]">Background</label>
            <select id="background-key" name="backgroundKey" defaultValue={message.background_key ?? "rose_glow"} className={fieldClass}>
              <option value="rose_glow">Rose glow</option>
              <option value="midnight">Midnight</option>
              <option value="champagne">Champagne</option>
              <option value="sunset">Sunset</option>
              <option value="ocean">Ocean</option>
              <option value="lavender">Lavender</option>
            </select>
          </div>
          <div>
            <label htmlFor="font-key" className="mb-1 block text-xs text-[#765d60]">Font</label>
            <select id="font-key" name="fontKey" defaultValue={message.font_key ?? "serif"} className={fieldClass}>
              <option value="serif">Serif</option>
              <option value="rounded">Rounded</option>
              <option value="modern">Modern</option>
              <option value="typewriter">Typewriter</option>
            </select>
          </div>
          <div>
            <label htmlFor="text-size-key" className="mb-1 block text-xs text-[#765d60]">Text size</label>
            <select id="text-size-key" name="textSizeKey" defaultValue={message.text_size_key ?? "medium"} className={fieldClass}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div>
            <label htmlFor="text-alignment-key" className="mb-1 block text-xs text-[#765d60]">Text alignment</label>
            <select id="text-alignment-key" name="textAlignmentKey" defaultValue={message.text_alignment_key ?? "center"} className={fieldClass}>
              <option value="leading">Leading</option>
              <option value="center">Center</option>
              <option value="trailing">Trailing</option>
            </select>
          </div>
          <div>
            <label htmlFor="text-position-key" className="mb-1 block text-xs text-[#765d60]">Text position</label>
            <select id="text-position-key" name="textPositionKey" defaultValue={message.text_position_key ?? "center"} className={fieldClass}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>
      </fieldset>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? "Saving…"
          : message.id
            ? "Save message"
            : "Create message"}
      </Button>
    </form>
  );
}
