import { useState } from "react";
import { Dialog, Flex, Text, TextField, Button } from "@radix-ui/themes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string) => void;
  existingNames: Set<string>;
}

export function AddNodeDialog({ open, onOpenChange, onAdd, existingNames }: Props) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const isDuplicate = existingNames.has(trimmed);
  const isValid = trimmed.length > 0 && !isDuplicate;

  const handleSubmit = () => {
    if (!isValid) return;
    onAdd(trimmed);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setName(""); }}>
      <Dialog.Content maxWidth="400px">
        <Dialog.Title>Add Activity</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Enter a name for the new activity node.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <label>
            <Text size="2" weight="medium">Activity name</Text>
            <TextField.Root
              mt="1"
              placeholder="e.g. confirm order"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
            />
          </label>
          {isDuplicate && (
            <Text size="1" color="red">An activity with this name already exists.</Text>
          )}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">Cancel</Button>
          </Dialog.Close>
          <Button disabled={!isValid} onClick={handleSubmit}>Add</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
