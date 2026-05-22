import { useEffect, useState } from "react";
import { Dialog, Flex, Text, Button, Select } from "@radix-ui/themes";
import type { RawConstraint, ConstraintLabel } from "../types";

type Quantifier = "none" | "each" | "any" | "all";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (constraint: RawConstraint) => void;
  source: string;
  target: string;
  objectTypes: string[];
  /** If set, we are editing an existing constraint */
  existing?: RawConstraint;
}

function emptyInvolvements(objectTypes: string[]): Record<string, Quantifier> {
  const inv: Record<string, Quantifier> = {};
  for (const ot of objectTypes) inv[ot] = "none";
  return inv;
}

function involvementsFromLabel(label: ConstraintLabel, objectTypes: string[]): Record<string, Quantifier> {
  const inv = emptyInvolvements(objectTypes);
  for (const ref of label.each) inv[ref.object_type] = "each";
  for (const ref of label.any) inv[ref.object_type] = "any";
  for (const ref of label.all) inv[ref.object_type] = "all";
  return inv;
}

function buildLabel(involvements: Record<string, Quantifier>): ConstraintLabel {
  const label: ConstraintLabel = { each: [], any: [], all: [] };
  for (const [ot, q] of Object.entries(involvements)) {
    if (q === "none") continue;
    label[q].push({ type: "Simple", object_type: ot });
  }
  return label;
}

export function ConstraintDialog({ open, onOpenChange, onConfirm, source, target, objectTypes, existing }: Props) {
  const [arcType, setArcType] = useState<"EF" | "EP" | "AS" | "DF" | "DP">("EF");
  const [involvements, setInvolvements] = useState<Record<string, Quantifier>>(() => emptyInvolvements(objectTypes));

  // Reset state when dialog opens with new data
  useEffect(() => {
    if (open) {
      if (existing) {
        setArcType(existing.arc_type);
        setInvolvements(involvementsFromLabel(existing.label, objectTypes));
      } else {
        setArcType("EF");
        setInvolvements(emptyInvolvements(objectTypes));
      }
    }
  }, [open, existing, objectTypes]);

  const hasAtLeastOneInvolvement = Object.values(involvements).some(q => q !== "none");

  const handleConfirm = () => {
    if (!hasAtLeastOneInvolvement) return;
    const constraint: RawConstraint = {
      from: source,
      to: target,
      arc_type: arcType,
      counts: [1, null],
      label: buildLabel(involvements),
    };
    onConfirm(constraint);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{existing ? "Edit Constraint" : "Add Constraint"}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {source} → {target}
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          {/* Arc type */}
          <Flex align="center" gap="3">
            <Text size="2" weight="medium" style={{ minWidth: 80 }}>Arc type</Text>
            <Select.Root value={arcType} onValueChange={(v) => setArcType(v as "EF" | "EP" | "AS" | "DF" | "DP")}>
              <Select.Trigger style={{ minWidth: 160 }} />
              <Select.Content>
                <Select.Item value="EF">EF (Eventually Follows)</Select.Item>
                <Select.Item value="EP">EP (Eventually Precedes)</Select.Item>
                <Select.Item value="DF">DF (Directly Follows)</Select.Item>
                <Select.Item value="DP">DP (Directly Precedes)</Select.Item>
                <Select.Item value="AS">AS (Association)</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          {/* Object type involvements */}
          <Text size="2" weight="medium">Object type involvements</Text>
          {objectTypes.map((ot) => (
            <Flex key={ot} align="center" gap="3">
              <Text size="2" style={{ minWidth: 100 }}>{ot}</Text>
              <Select.Root
                value={involvements[ot] ?? "none"}
                onValueChange={(v) => setInvolvements(prev => ({ ...prev, [ot]: v as Quantifier }))}
              >
                <Select.Trigger style={{ minWidth: 120 }} />
                <Select.Content>
                  <Select.Item value="none">—</Select.Item>
                  <Select.Item value="each">EACH</Select.Item>
                  <Select.Item value="any">ANY</Select.Item>
                  <Select.Item value="all">ALL</Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>
          ))}

          {!hasAtLeastOneInvolvement && (
            <Text size="1" color="red">Select at least one object type involvement.</Text>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">Cancel</Button>
          </Dialog.Close>
          <Button disabled={!hasAtLeastOneInvolvement} onClick={handleConfirm}>
            {existing ? "Update" : "Add"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
