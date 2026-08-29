/**
 * "Add to collection", for one keyword or a whole selection.
 *
 * Creating a collection is inline rather than a second dialog: the moment you
 * most want a new list is the moment you have keywords in hand, and sending
 * someone to a separate screen to make one would lose the selection they just
 * built.
 *
 * The add is idempotent server-side, so re-adding a keyword is not an error —
 * it reports back as "already saved" rather than failing, and the volume
 * snapshot of the first save is kept.
 */
import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { COLLECTION_NAME_MAX_LENGTH } from "../../../shared/collections";
import type { KeywordRow } from "../../../shared/keywords";
import { errorMessage } from "../../lib/api";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
  useToast,
} from "../ui";
import { formatVolume } from "./format";
import { useAddKeywords, useCollections, useCreateCollection } from "./queries";
import type { KeywordToAdd } from "./queries";

/** Volume travels with the keyword so the snapshot means something. */
export function toKeywordsToAdd(rows: ReadonlyArray<KeywordRow>): KeywordToAdd[] {
  return rows.map((row) => ({
    keyword: row.keyword,
    volumeSnapshot: row.searchVolume,
  }));
}

export function AddToCollectionDialog({
  workspaceId,
  open,
  onClose,
  keywords,
}: {
  workspaceId: string | null;
  open: boolean;
  onClose: () => void;
  keywords: KeywordToAdd[];
}) {
  const { toast } = useToast();
  const { data, isPending } = useCollections(workspaceId);
  const createCollection = useCreateCollection(workspaceId);
  const addKeywords = useAddKeywords(workspaceId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const collections = data?.collections ?? [];

  // Reset per opening: a dialog that reopens holding the last run's state is a
  // reliable way to add keywords to the wrong list.
  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setNewName("");
    setError(null);
  }, [open]);

  const creating = newName.trim() !== "";
  const busy = createCollection.isPending || addKeywords.isPending;
  const canSubmit = keywords.length > 0 && (creating || selectedId !== null);

  async function submit() {
    if (!canSubmit || busy) return;
    setError(null);

    try {
      const collectionId = creating
        ? (await createCollection.mutateAsync(newName.trim())).collection.id
        : selectedId;
      if (collectionId === null) return;

      const result = await addKeywords.mutateAsync({ collectionId, keywords });

      const name = creating
        ? newName.trim()
        : (collections.find((item) => item.id === collectionId)?.name ??
          "the collection");

      toast({
        title:
          result.added === 0
            ? "Already saved"
            : `Saved ${formatVolume(result.added)} keyword${result.added === 1 ? "" : "s"}`,
        description:
          result.skipped > 0
            ? `${formatVolume(result.skipped)} already in "${name}".`
            : `Added to "${name}".`,
        tone: "success",
      });
      onClose();
    } catch (caught) {
      // Kept inside the dialog rather than toasted: the user is still here,
      // and the fix (a different name, a different list) is in front of them.
      setError(errorMessage(caught, "Could not save these keywords."));
    }
  }

  const title =
    keywords.length === 1 && keywords[0] !== undefined
      ? `Save "${keywords[0].keyword}"`
      : `Save ${formatVolume(keywords.length)} keywords`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Add to an existing collection, or start a new one."
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSubmit}>
            {creating ? "Create and save" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-app" />
            <Skeleton className="h-10 w-full rounded-app" />
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No collections yet"
            description="Name your first one below and these keywords go straight into it."
          />
        ) : (
          <fieldset
            className="flex max-h-64 flex-col gap-1 overflow-y-auto"
            // Choosing an existing list and naming a new one are exclusive;
            // typing a name disables the radios rather than silently winning.
            disabled={creating || busy}
          >
            <legend className="pb-2 text-sm font-medium text-foreground">
              Existing collections
            </legend>
            {collections.map((collection) => (
              <label
                key={collection.id}
                className="flex cursor-pointer items-center gap-3 rounded-app px-3 py-2 transition-colors hover:bg-surface-muted has-checked:bg-tint has-disabled:cursor-not-allowed has-disabled:opacity-60"
              >
                <input
                  type="radio"
                  name="collection"
                  className="size-4 shrink-0 accent-primary"
                  value={collection.id}
                  checked={selectedId === collection.id}
                  onChange={() => setSelectedId(collection.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {collection.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatVolume(collection.keywordCount)} keywords
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <Field
          label="New collection"
          hint={`Leave blank to use an existing one. Up to ${COLLECTION_NAME_MAX_LENGTH} characters.`}
          error={error ?? undefined}
        >
          {(props) => (
            <Input
              {...props}
              value={newName}
              maxLength={COLLECTION_NAME_MAX_LENGTH}
              placeholder="e.g. Q4 content plan"
              disabled={busy}
              onChange={(event) => setNewName(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
