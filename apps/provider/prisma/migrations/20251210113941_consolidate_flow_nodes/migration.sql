/*
  Warnings:

  - You are about to drop the column `nodeId` on the `FlowEvent` table. All the data in the column will be lost.
  - You are about to drop the column `currentNodeId` on the `FlowRun` table. All the data in the column will be lost.
  - You are about to drop the `FlowNode` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FlowEvent" DROP CONSTRAINT "FlowEvent_nodeId_fkey";

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_failureNodeId_fkey";

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_flowId_fkey";

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_nextNodeId_fkey";

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "FlowNode" DROP CONSTRAINT "FlowNode_uiPromptId_fkey";

-- DropForeignKey
ALTER TABLE "FlowRun" DROP CONSTRAINT "FlowRun_currentNodeId_fkey";

-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "nodes" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "FlowEvent" DROP COLUMN "nodeId",
ADD COLUMN     "nodeIndex" INTEGER;

-- AlterTable
ALTER TABLE "FlowRun" DROP COLUMN "currentNodeId",
ADD COLUMN     "currentNodeIndex" INTEGER;

-- DropTable
DROP TABLE "FlowNode";
