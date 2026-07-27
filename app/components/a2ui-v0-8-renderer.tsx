"use client";

import {
  useAgent,
  useCopilotKit,
  type ReactActivityMessageRenderer,
} from "@copilotkit/react-core/v2";
import { useCallback, useState } from "react";
import { z } from "zod";

type A2UIOperation = {
  beginRendering?: { surfaceId?: string };
  surfaceUpdate?: {
    surfaceId?: string;
    components?: Array<{
      id?: string;
      component?: Record<string, unknown>;
    }>;
  };
  dataModelUpdate?: {
    surfaceId?: string;
    contents?: A2UIDataEntry[];
  };
};

type A2UIDataEntry = {
  key: string;
  valueString?: string;
  valueMap?: A2UIDataEntry[];
};

type Restaurant = {
  name?: string;
  rating?: string;
  detail?: string;
  infoLink?: string;
  imageUrl?: string;
  address?: string;
};

type BookingModel = {
  title?: string;
  address?: string;
  restaurantName?: string;
  partySize?: string;
  reservationTime?: string;
  dietary?: string;
  imageUrl?: string;
};

type ConfirmationModel = {
  title?: string;
  imageUrl?: string;
  bookingDetails?: string;
  dietaryRequirements?: string;
};

function getOperations(content: unknown): A2UIOperation[] {
  if (!content || typeof content !== "object") {
    return [];
  }

  const payload = content as {
    a2ui_operations?: A2UIOperation[];
    operations?: A2UIOperation[];
  };

  const operations = payload.a2ui_operations ?? payload.operations;
  if (Array.isArray(operations)) {
    return operations;
  }

  if (!operations || typeof operations !== "object") {
    return [];
  }

  if (
    "beginRendering" in operations ||
    "surfaceUpdate" in operations ||
    "dataModelUpdate" in operations
  ) {
    return [operations as A2UIOperation];
  }

  return Object.values(operations).filter(
    (operation): operation is A2UIOperation =>
      !!operation && typeof operation === "object",
  );
}

function getSurfaceId(operations: A2UIOperation[]): string | undefined {
  for (const op of operations) {
    const id =
      op.beginRendering?.surfaceId ??
      op.surfaceUpdate?.surfaceId ??
      op.dataModelUpdate?.surfaceId;
    if (id) return id;
  }
  return undefined;
}

function getComponentLiteralText(
  operations: A2UIOperation[],
  componentId: string,
): string | undefined {
  for (const op of operations) {
    const comp = op.surfaceUpdate?.components?.find((c) => c.id === componentId);
    const text = comp?.component as { Text?: { text?: { literalString?: string } } } | undefined;
    const s = text?.Text?.text?.literalString;
    if (s) return s;
  }
  return undefined;
}

function dataEntriesToObject<T extends Record<string, string>>(
  entries: A2UIDataEntry[] = [],
): T {
  return Object.fromEntries(
    entries.map((entry) => [entry.key, entry.valueString ?? ""]),
  ) as T;
}

function getRestaurants(operations: A2UIOperation[]): Restaurant[] {
  const dataModel = operations.find(
    (operation) => operation.dataModelUpdate,
  )?.dataModelUpdate;

  const itemsEntry = dataModel?.contents?.find(
    (entry) => entry.key === "items",
  );
  return (itemsEntry?.valueMap ?? []).map((entry) =>
    dataEntriesToObject<Restaurant & Record<string, string>>(entry.valueMap),
  );
}

function getBookingModel(operations: A2UIOperation[]): BookingModel {
  const dataModel = operations.find(
    (operation) => operation.dataModelUpdate,
  )?.dataModelUpdate;
  return dataEntriesToObject<BookingModel & Record<string, string>>(
    dataModel?.contents ?? [],
  );
}

function readableInfoLink(infoLink: string | undefined): string | null {
  if (!infoLink) {
    return null;
  }

  const match = infoLink.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return match?.[2] ?? infoLink;
}

function useA2UIAction() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "default" });

  return useCallback(
    async (
      actionName: string,
      sourceComponentId: string,
      surfaceId: string,
      context: Record<string, string>,
    ) => {
      if (!copilotkit || !agent) return;
      const message = {
        userAction: {
          actionName,
          sourceComponentId,
          surfaceId,
          timestamp: new Date().toISOString(),
          context,
        },
      };
      try {
        copilotkit.setProperties({
          ...copilotkit.properties,
          a2uiAction: message,
        });
        await copilotkit.runAgent({ agent });
      } finally {
        if (copilotkit.properties) {
          const { a2uiAction: _drop, ...rest } = copilotkit.properties;
          copilotkit.setProperties(rest);
        }
      }
    },
    [copilotkit, agent],
  );
}

function RestaurantList({
  operations,
  surfaceId,
}: {
  operations: A2UIOperation[];
  surfaceId: string;
}) {
  const dispatch = useA2UIAction();
  const restaurants = getRestaurants(operations);
  const title =
    getComponentLiteralText(operations, "title-heading") ?? "Top Restaurants";

  return (
    <div className="flex flex-col gap-4 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="flex flex-col gap-3">
        {restaurants.map((restaurant, index) => (
          <article
            key={`${restaurant.name ?? "restaurant"}-${index}`}
            className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-[144px_1fr]"
          >
            {restaurant.imageUrl ? (
              <img
                src={restaurant.imageUrl}
                alt={restaurant.name ?? "Restaurant"}
                className="h-32 w-full rounded-md object-cover sm:h-full"
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2">
              <div>
                <h3 className="text-base font-semibold text-gray-950">
                  {restaurant.name}
                </h3>
                {restaurant.rating ? (
                  <p className="text-sm text-amber-500">{restaurant.rating}</p>
                ) : null}
              </div>
              {restaurant.detail ? (
                <p className="text-sm text-gray-600">{restaurant.detail}</p>
              ) : null}
              {restaurant.address ? (
                <p className="text-xs text-gray-500">{restaurant.address}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                {readableInfoLink(restaurant.infoLink) ? (
                  <a
                    href={readableInfoLink(restaurant.infoLink) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700"
                  >
                    More Info
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    dispatch(
                      "book_restaurant",
                      "template-book-button",
                      surfaceId,
                      {
                        restaurantName: restaurant.name ?? "",
                        imageUrl: restaurant.imageUrl ?? "",
                        address: restaurant.address ?? "",
                      },
                    )
                  }
                  className="inline-flex h-9 items-center rounded-md bg-[#FF0000] px-3 text-sm font-medium text-white"
                >
                  Book Now
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BookingForm({
  operations,
  surfaceId,
}: {
  operations: A2UIOperation[];
  surfaceId: string;
}) {
  const dispatch = useA2UIAction();
  const initial = getBookingModel(operations);
  const [partySize, setPartySize] = useState(initial.partySize ?? "2");
  const [reservationTime, setReservationTime] = useState(
    initial.reservationTime ?? "",
  );
  const [dietary, setDietary] = useState(initial.dietary ?? "");
  const [submitting, setSubmitting] = useState(false);

  const title = initial.title ?? `Book a table at ${initial.restaurantName ?? ""}`;

  const submit = async () => {
    setSubmitting(true);
    try {
      await dispatch("submit_booking", "submit-button", surfaceId, {
        restaurantName: initial.restaurantName ?? "",
        partySize,
        reservationTime,
        dietary,
        imageUrl: initial.imageUrl ?? "",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {initial.imageUrl ? (
          <img
            src={initial.imageUrl}
            alt={initial.restaurantName ?? "Restaurant"}
            className="h-40 w-full rounded-md object-cover"
          />
        ) : null}
        {initial.address ? (
          <p className="text-sm text-gray-600">{initial.address}</p>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Party Size</span>
          <input
            type="number"
            min={1}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            className="h-9 rounded-md border border-gray-200 px-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Date & Time</span>
          <input
            type="datetime-local"
            value={reservationTime}
            onChange={(e) => setReservationTime(e.target.value)}
            className="h-9 rounded-md border border-gray-200 px-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">Dietary Requirements</span>
          <input
            type="text"
            value={dietary}
            onChange={(e) => setDietary(e.target.value)}
            className="h-9 rounded-md border border-gray-200 px-3"
          />
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-[#FF0000] px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Reservation"}
        </button>
      </div>
    </div>
  );
}

function BookingConfirmation({
  operations,
}: {
  operations: A2UIOperation[];
}) {
  const model = dataEntriesToObject<ConfirmationModel & Record<string, string>>(
    operations.find((op) => op.dataModelUpdate)?.dataModelUpdate?.contents ?? [],
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {model.title ? (
          <h2 className="text-lg font-semibold text-gray-950">{model.title}</h2>
        ) : null}
        {model.imageUrl ? (
          <img
            src={model.imageUrl}
            alt={model.title ?? "Reservation"}
            className="h-40 w-full rounded-md object-cover"
          />
        ) : null}
        {model.bookingDetails ? (
          <>
            <hr className="border-gray-100" />
            <p className="text-sm text-gray-700">{model.bookingDetails}</p>
          </>
        ) : null}
        {model.dietaryRequirements ? (
          <>
            <hr className="border-gray-100" />
            <p className="text-sm text-gray-600">
              {model.dietaryRequirements}
            </p>
          </>
        ) : null}
        <hr className="border-gray-100" />
        <p className="text-sm font-medium text-gray-800">
          We look forward to seeing you!
        </p>
      </div>
    </div>
  );
}

function A2UIV08Surface({ content }: { content: unknown }) {
  const operations = getOperations(content);

  if (!operations.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Generating UI...
      </div>
    );
  }

  const surfaceId = getSurfaceId(operations) ?? "default";

  if (surfaceId === "booking-form") {
    return <BookingForm operations={operations} surfaceId={surfaceId} />;
  }

  if (surfaceId === "confirmation") {
    return <BookingConfirmation operations={operations} />;
  }

  return <RestaurantList operations={operations} surfaceId={surfaceId} />;
}

export const a2uiV08Renderer: ReactActivityMessageRenderer<unknown> = {
  activityType: "a2ui-surface",
  content: z.unknown(),
  render: ({ content }) => <A2UIV08Surface content={content} />,
};
