/**
 * `/app/keyword-research/collections` — every saved keyword list in the
 * workspace.
 *
 * Pure D1 behind this screen: no DataForSEO call, nothing billed, so there is
 * no cost chip anywhere on it and mutations can be optimistic about being
 * cheap. Deleting is the one irreversible action and is the only one behind a
 * confirmation.
 */
import { ArrowLeft, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { Link } from "react-router";

import type { CollectionSummary } from "../../../shared/collections";
import { COLLECTION_NAME_MAX_LENGTH } from "../../../shared/collections";
import {
  ApiErrorNotice,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { formatDate, formatVolume } from "../../components/keywords/format";
import { LinkButton } from "../../components/keywords/link-button";
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useRenameCollection,
} from "../../components/keywords/queries";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  createDataTableColumns,
  useToast,
} from "../../components/ui";
import type { DataTableColumn } from "../../components/ui";
import { errorMessage } from "../../lib/api";

/* ------------------------------- row context ------------------------------- */

interface RowActions {
  onRename: (collection: CollectionSummary) => void;
  onDelete: (collection: CollectionSummary) => void;
}

const RowContext = createContext<RowActions | null>(null);

function useRowActions(): RowActions {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Collection rows must render inside <CollectionsList>");
  }
  return context;
}

function ActionsCell({ collection }: { collection: CollectionSummary }) {
  const { onRename, onDelete } = useRowActions();
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onRename(collection)}
        aria-label={`Rename ${collection.name}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDelete(collection)}
        aria-label={`Delete ${collection.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete
      </Button>
    </div>
  );
}

const col = createDataTableColumns<CollectionSummary>();

const columns: Array<DataTableColumn<CollectionSummary>> = [
  col.accessor("name", {
    header: "Collection",
    cell: (info) => (
      <Link
        to={info.row.original.id}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {info.getValue<string>()}
      </Link>
    ),
  }),
  col.accessor("keywordCount", {
    header: "Keywords",
    cell: (info) => (
      <span className="tabular-nums">{formatVolume(info.getValue<number>())}</span>
    ),
  }),
  col.accessor("createdAt", {
    header: "Created",
    cell: (info) => (
      <span className="text-muted-foreground">
        {formatDate(info.getValue<string>())}
      </span>
    ),
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <ActionsCell collection={info.row.original} />,
  }),
];

/* --------------------------------- screen ---------------------------------- */

export function CollectionsList({ workspaceId }: { workspaceId: string | null }) {
  const { toast } = useToast();
  const query = useCollections(workspaceId);
  useApiErrorToast(query.error, "Could not load collections");

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<CollectionSummary | null>(null);
  const [deleting, setDeleting] = useState<CollectionSummary | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createCollection = useCreateCollection(workspaceId);
  const renameCollection = useRenameCollection(workspaceId, renaming?.id ?? null);
  const deleteCollection = useDeleteCollection(workspaceId);

  const collections = query.data?.collections ?? [];

  function openCreate() {
    setName("");
    setFormError(null);
    setCreating(true);
  }

  function openRename(collection: CollectionSummary) {
    setName(collection.name);
    setFormError(null);
    setRenaming(collection);
  }

  async function submitCreate() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("A collection needs a name.");
      return;
    }
    try {
      await createCollection.mutateAsync(trimmed);
      toast({ title: `Created "${trimmed}"`, tone: "success" });
      setCreating(false);
    } catch (error) {
      setFormError(errorMessage(error, "Could not create the collection."));
    }
  }

  async function submitRename() {
    const trimmed = name.trim();
    if (trimmed === "" || renaming === null) {
      setFormError("A collection needs a name.");
      return;
    }
    try {
      await renameCollection.mutateAsync(trimmed);
      toast({ title: `Renamed to "${trimmed}"`, tone: "success" });
      setRenaming(null);
    } catch (error) {
      setFormError(errorMessage(error, "Could not rename the collection."));
    }
  }

  async function submitDelete() {
    if (deleting === null) return;
    try {
      await deleteCollection.mutateAsync(deleting.id);
      toast({ title: `Deleted "${deleting.name}"`, tone: "success" });
      setDeleting(null);
    } catch (error) {
      toast({
        title: "Could not delete the collection",
        description: errorMessage(error, "Please try again."),
        tone: "error",
      });
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Collections"
        description="Keyword lists saved from your research. Each keeps the search volume it had when you saved it, so a list stays comparable against itself over time."
        actions={
          <>
            <LinkButton to=".." variant="secondary">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to research
            </LinkButton>
            <Button onClick={openCreate}>
              <FolderPlus className="size-4" aria-hidden="true" />
              New collection
            </Button>
          </>
        }
      />

      {query.isError ? (
        <ApiErrorNotice error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <RowContext.Provider value={{ onRename: openRename, onDelete: setDeleting }}>
          <DataTable
            columns={columns}
            data={collections}
            loading={query.isPending}
            caption="Keyword collections"
            emptyState={
              <EmptyState
                icon={FolderPlus}
                title="No collections yet"
                description="Save keywords from a search to build your first list."
                action={<Button onClick={openCreate}>New collection</Button>}
              />
            }
          />
        </RowContext.Provider>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New collection"
        dismissible={!createCollection.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCreating(false)}
              disabled={createCollection.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitCreate()}
              loading={createCollection.isPending}
            >
              Create
            </Button>
          </>
        }
      >
        <Field label="Name" error={formError ?? undefined} required>
          {(props) => (
            <Input
              {...props}
              value={name}
              maxLength={COLLECTION_NAME_MAX_LENGTH}
              placeholder="e.g. Q4 content plan"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename collection"
        dismissible={!renameCollection.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRenaming(null)}
              disabled={renameCollection.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitRename()}
              loading={renameCollection.isPending}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" error={formError ?? undefined} required>
          {(props) => (
            <Input
              {...props}
              value={name}
              maxLength={COLLECTION_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void submitDelete()}
        loading={deleteCollection.isPending}
        title="Delete this collection?"
        description={
          deleting === null
            ? undefined
            : `"${deleting.name}" and its ${formatVolume(deleting.keywordCount)} saved keywords will be removed. This cannot be undone.`
        }
        confirmLabel="Delete"
      />
    </div>
  );
}
