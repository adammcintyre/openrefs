/**
 * `/app/keyword-research/collections/:id` — one saved keyword list.
 *
 * The volume column is a *snapshot*: what the keyword was doing when it was
 * saved, not what it is doing now. That is the point of the column and why the
 * header says so — refreshing it silently would destroy the only thing that
 * makes a list comparable against its own history, and would cost money to do.
 */
import { ArrowLeft, Download, FolderOpen, Pencil, Search, Trash2, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import type { CollectionKeywordRow } from "../../../shared/collections";
import { COLLECTION_NAME_MAX_LENGTH } from "../../../shared/collections";
import type { MetaLocationOption } from "../../../shared/keywords";
import { marketLabel } from "../../components/domains/market-options";
import type { MarketSelection } from "../../components/keywords/market";
import { useMetaLocations } from "../../components/keywords/queries";
import { SerpPanel } from "../../components/serp-panel";
import { MarketPickerDialog } from "./market-picker-dialog";
import {
  ApiErrorNotice,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { formatDate, formatVolume } from "../../components/keywords/format";
import { AnchorButton, LinkButton } from "../../components/keywords/link-button";
import {
  collectionExportUrl,
  useCollection,
  useDeleteCollection,
  useRemoveKeywords,
  useRenameCollection,
} from "../../components/keywords/queries";
import {
  Badge,
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

interface RowContextValue {
  rows: ReadonlyArray<CollectionKeywordRow>;
  selected: ReadonlySet<string>;
  onToggle: (keyword: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: CollectionKeywordRow) => void;
  /** For naming a row's saved market; empty until /meta/locations lands. */
  locations: ReadonlyArray<MetaLocationOption>;
}

const RowContext = createContext<RowContextValue | null>(null);

function useRowContext(): RowContextValue {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Collection keyword rows must render inside <CollectionDetail>");
  }
  return context;
}

const CHECKBOX_CLASS = "size-4 shrink-0 cursor-pointer accent-primary";

function SelectAllHeader() {
  const { rows, selected, onToggleAll } = useRowContext();
  const total = rows.length;
  const chosen = rows.filter((row) => selected.has(row.keyword)).length;
  const allChosen = total > 0 && chosen === total;

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={allChosen}
      disabled={total === 0}
      ref={(node) => {
        if (node) node.indeterminate = chosen > 0 && !allChosen;
      }}
      onChange={(event) => onToggleAll(event.target.checked)}
      aria-label={
        allChosen
          ? `Clear selection of ${total} keywords`
          : `Select all ${total} keywords`
      }
    />
  );
}

function SelectCell({ keyword }: { keyword: string }) {
  const { selected, onToggle } = useRowContext();
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={selected.has(keyword)}
      onChange={() => onToggle(keyword)}
      aria-label={`Select ${keyword}`}
    />
  );
}

/**
 * The market this keyword was saved in — or the fact that we do not know.
 *
 * `null` is "unknown", never "the workspace default"
 * (`src/shared/collections.ts` says so in as many words). Rows added before
 * collections recorded a market carry it, and showing them as UK would be
 * inventing a fact. The badge is what tells a user why some rows open a SERP
 * straight away and others ask a question first.
 */
function MarketCell({ row }: { row: CollectionKeywordRow }) {
  const { locations } = useRowContext();

  if (row.locationCode === null || row.languageCode === null) {
    return (
      <span
        className="text-muted-foreground"
        title="This keyword was saved before collections recorded a market, so we don't know which one it was researched in. Viewing its SERP will ask."
      >
        Unknown
      </span>
    );
  }

  return (
    <Badge variant="neutral">
      {marketLabel(locations, row.locationCode, row.languageCode)}
    </Badge>
  );
}

function SerpActionCell({ row }: { row: CollectionKeywordRow }) {
  const { onViewSerp } = useRowContext();
  const known = row.locationCode !== null && row.languageCode !== null;

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onViewSerp(row)}
      aria-label={`View SERP for ${row.keyword}`}
      title={
        known
          ? "Open the search results for this keyword, in the market it was saved in."
          : "Open the search results for this keyword — we'll ask which market first."
      }
    >
      <Search className="size-3.5" aria-hidden="true" />
      SERP
    </Button>
  );
}

const col = createDataTableColumns<CollectionKeywordRow>();

const columns: Array<DataTableColumn<CollectionKeywordRow>> = [
  col.display({
    id: "select",
    header: () => <SelectAllHeader />,
    cell: (info) => <SelectCell keyword={info.row.original.keyword} />,
  }),
  col.accessor("keyword", {
    header: "Keyword",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  // null (saved without a volume) must sort apart from a real 0, so the
  // accessor hands v9's sortUndefined an undefined and the cell reads the
  // original to render an em dash.
  col.accessor((row) => row.volumeSnapshot ?? undefined, {
    id: "volumeSnapshot",
    header: "Volume when saved",
    cell: (info) => (
      <span className="tabular-nums">
        {formatVolume(info.row.original.volumeSnapshot)}
      </span>
    ),
  }),
  col.accessor((row) => row.locationCode ?? undefined, {
    id: "market",
    header: "Market",
    cell: (info) => <MarketCell row={info.row.original} />,
  }),
  col.accessor("addedAt", {
    header: "Added",
    cell: (info) => (
      <span className="text-muted-foreground">
        {formatDate(info.getValue<string>())}
      </span>
    ),
  }),
  col.display({
    id: "actions",
    header: "",
    cell: (info) => <SerpActionCell row={info.row.original} />,
  }),
];

/* --------------------------------- screen ---------------------------------- */

export function CollectionDetail({ workspaceId }: { workspaceId: string | null }) {
  const { id = null } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const query = useCollection(workspaceId, id);
  useApiErrorToast(query.error, "Could not load this collection");

  const renameCollection = useRenameCollection(workspaceId, id);
  const deleteCollection = useDeleteCollection(workspaceId);
  const removeKeywords = useRemoveKeywords(workspaceId, id);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * The SERP flow, in two pieces.
   *
   * `serpTarget` is the keyword whose SERP is open and the market to open it
   * in — set directly when the row already knows its market. `pendingKeyword`
   * is the other path: a row with a null market, waiting on the picker. They
   * are separate because the panel needs a concrete market before it mounts
   * (`SerpPanelProps` takes non-nullable codes), so "asking" and "showing" are
   * genuinely two states rather than one with a hole in it.
   */
  const [serpTarget, setSerpTarget] = useState<
    { keyword: string; market: MarketSelection } | null
  >(null);
  const [pendingKeyword, setPendingKeyword] = useState<string | null>(null);

  const locationsQuery = useMetaLocations(workspaceId);

  const rows = useMemo(() => query.data?.keywords ?? [], [query.data]);

  const onViewSerp = useCallback((row: CollectionKeywordRow) => {
    if (row.locationCode !== null && row.languageCode !== null) {
      setSerpTarget({
        keyword: row.keyword,
        market: {
          locationCode: row.locationCode,
          languageCode: row.languageCode,
        },
      });
      return;
    }
    // Unknown market: ask rather than assume. Showing UK results for a keyword
    // saved while researching the US would be a wrong answer that looks right.
    setPendingKeyword(row.keyword);
  }, []);

  const onToggle = useCallback((keyword: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.keyword)) : new Set());
    },
    [rows],
  );

  async function submitRename() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("A collection needs a name.");
      return;
    }
    try {
      await renameCollection.mutateAsync(trimmed);
      toast({ title: `Renamed to "${trimmed}"`, tone: "success" });
      setRenaming(false);
    } catch (error) {
      setFormError(errorMessage(error, "Could not rename the collection."));
    }
  }

  async function submitDelete() {
    if (id === null) return;
    try {
      await deleteCollection.mutateAsync(id);
      toast({ title: "Collection deleted", tone: "success" });
      void navigate("..", { replace: true });
    } catch (error) {
      toast({
        title: "Could not delete the collection",
        description: errorMessage(error, "Please try again."),
        tone: "error",
      });
    }
  }

  async function submitRemove() {
    const keywords = [...selected];
    if (keywords.length === 0) return;
    try {
      const result = await removeKeywords.mutateAsync(keywords);
      setSelected(new Set());
      setRemoving(false);
      toast({
        title: `Removed ${formatVolume(result.removed)} keyword${result.removed === 1 ? "" : "s"}`,
        tone: "success",
      });
    } catch (error) {
      setRemoving(false);
      toast({
        title: "Could not remove those keywords",
        description: errorMessage(error, "Please try again."),
        tone: "error",
      });
    }
  }

  if (query.isError) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Collection"
          actions={
            <LinkButton to=".." variant="secondary">
              <ArrowLeft className="size-4" aria-hidden="true" />
              All collections
            </LinkButton>
          }
        />
        <ApiErrorNotice error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const collection = query.data;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={collection?.name ?? "Collection"}
        description={
          collection === undefined
            ? undefined
            : `${formatVolume(collection.keywordCount)} keywords · created ${formatDate(collection.createdAt)}`
        }
        actions={
          <>
            <LinkButton to=".." variant="secondary">
              <ArrowLeft className="size-4" aria-hidden="true" />
              All collections
            </LinkButton>
            {workspaceId !== null && id !== null ? (
              <AnchorButton
                href={collectionExportUrl(workspaceId, id)}
                variant="secondary"
              >
                <Download className="size-4" aria-hidden="true" />
                Export CSV
              </AnchorButton>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setName(collection?.name ?? "");
                setFormError(null);
                setRenaming(true);
              }}
              disabled={collection === undefined}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Rename
            </Button>
            <Button
              variant="danger"
              onClick={() => setDeleting(true)}
              disabled={collection === undefined}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      {selected.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-app border border-primary/40 bg-tint p-3">
          <p className="text-sm font-medium text-tint-foreground" aria-live="polite">
            {`${formatVolume(selected.size)} keyword${selected.size === 1 ? "" : "s"} selected`}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="danger" onClick={() => setRemoving(true)}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Remove selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <RowContext.Provider
        value={{
          rows,
          selected,
          onToggle,
          onToggleAll,
          onViewSerp,
          locations: locationsQuery.data?.locations ?? [],
        }}
      >
        <DataTable
          columns={columns}
          data={rows}
          loading={query.isPending}
          caption={`Keywords in ${collection?.name ?? "this collection"}`}
          emptyState={
            <EmptyState
              icon={FolderOpen}
              title="No keywords saved yet"
              description="Run a search and use “Add to collection” on any keyword to fill this list."
              action={<LinkButton to="../..">Go to Keyword Research</LinkButton>}
            />
          }
        />
      </RowContext.Provider>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename collection"
        dismissible={!renameCollection.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRenaming(false)}
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
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => void submitDelete()}
        loading={deleteCollection.isPending}
        title="Delete this collection?"
        description={
          collection === undefined
            ? undefined
            : `"${collection.name}" and its ${formatVolume(collection.keywordCount)} saved keywords will be removed. This cannot be undone.`
        }
        confirmLabel="Delete"
      />

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => void submitRemove()}
        loading={removeKeywords.isPending}
        title="Remove selected keywords?"
        description={`${formatVolume(selected.size)} keyword${selected.size === 1 ? "" : "s"} will be removed from this collection.`}
        confirmLabel="Remove"
      />

      <MarketPickerDialog
        open={pendingKeyword !== null}
        keyword={pendingKeyword ?? ""}
        workspaceId={workspaceId}
        onClose={() => setPendingKeyword(null)}
        onConfirm={(market) => {
          if (pendingKeyword === null) return;
          setSerpTarget({ keyword: pendingKeyword, market });
          setPendingKeyword(null);
        }}
      />

      {/*
        Mounted only with a concrete market: SerpPanel's props are frozen and
        non-nullable, and a panel opened with a placeholder market would spend
        on the wrong country's results.
      */}
      {serpTarget === null || workspaceId === null ? null : (
        <SerpPanel
          workspaceId={workspaceId}
          keyword={serpTarget.keyword}
          locationCode={serpTarget.market.locationCode}
          languageCode={serpTarget.market.languageCode}
          open
          onClose={() => setSerpTarget(null)}
        />
      )}
    </div>
  );
}
